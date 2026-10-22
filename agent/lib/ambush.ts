import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ADVISORY_STREAM, AMBUSH_API } from "#lib/constants.ts";
import { INCIDENT_STREAM_NAME, INCIDENT_STREAM_PROMPT, SHADOW_DAYS } from "#lib/incidents.ts";
import { readSettings, updateSettings } from "#lib/settings.ts";

async function ambush(path: string, init: { method?: string; body?: unknown } = {}) {
  const key = process.env.AMBUSH_API_KEY;
  if (!key) {
    throw new Error(
      "AMBUSH_API_KEY isn't set. Add it in the Vercel project's environment variables and redeploy.",
    );
  }
  return fetch(`${AMBUSH_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function failure(response: Response, doing: string) {
  return new Error(`Ambush answered ${response.status} ${doing}: ${(await response.text()).slice(0, 300)}`);
}

const channelsSchema = z.object({
  channels: z.array(z.object({ id: z.string(), type: z.string(), label: z.string() })),
});

/**
 * Points an Ambush webhook at this deployment. Safe to run again: it reuses
 * the webhook it made. What the webhook hears is `setAlertTopics`.
 */
export async function connectToAmbush(url: string): Promise<{ webhookId: string; created: boolean }> {
  let settings = await readSettings();
  // Kept before the webhook exists: creating it sends a signed test event
  // that this deployment must already be able to verify.
  if (!settings.webhookSecret || settings.webhookUrl !== url) {
    settings = await updateSettings({
      webhookSecret: `whsec_${randomBytes(32).toString("base64")}`,
      webhookUrl: url,
      webhookId: undefined,
    });
  }

  let webhookId = settings.webhookId;
  let created = false;
  if (!webhookId) {
    const list = await ambush("/channels");
    if (!list.ok) throw await failure(list, "listing destinations");
    // A webhook's label is its URL.
    const existing = channelsSchema
      .parse(await list.json())
      .channels.find((channel) => channel.type === "webhook" && channel.label === url);
    if (existing) {
      await ambush(`/channels/${existing.id}`, { method: "DELETE" });
    }
    const response = await ambush("/channels", {
      method: "POST",
      body: { type: "webhook", url, secret: settings.webhookSecret },
    });
    if (!response.ok) throw await failure(response, "creating the webhook");
    webhookId = z.object({ id: z.string() }).parse(await response.json()).id;
    created = true;
    await updateSettings({ webhookId });
  }
  return { webhookId, created };
}

export interface AlertTopics {
  readonly packages: boolean;
  readonly incidents: boolean;
}

/** A one-minute interval is what makes Ambush retry a delivery we miss. */
const ROUTE = { minimum_delivery_interval_minutes: 1 };

async function setPackages(webhookId: string, on: boolean) {
  const path = `/feed-templates/${ADVISORY_STREAM}/subscriptions`;
  const response = on
    ? await ambush(path, { method: "POST", body: { emission_channel_id: webhookId, ...ROUTE } })
    : await ambush(`${path}/${webhookId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 409 && response.status !== 404) {
    throw await failure(response, `${on ? "subscribing to" : "unsubscribing from"} Package Security Advisories`);
  }
}

/** Creates the person's own incident stream the first time, and pauses or
 *  resumes it after that. */
async function setIncidents(webhookId: string, on: boolean): Promise<string | undefined> {
  let { incidentFeedId } = await readSettings();
  if (incidentFeedId && (await ambush(`/feeds/${incidentFeedId}`)).status === 404) incidentFeedId = undefined;
  if (!on) {
    if (incidentFeedId) {
      const paused = await ambush(`/feeds/${incidentFeedId}`, { method: "PATCH", body: { status: "paused" } });
      if (!paused.ok) throw await failure(paused, "pausing the incident stream");
    }
    return incidentFeedId;
  }
  if (!incidentFeedId) {
    const created = await ambush("/feeds", {
      method: "POST",
      body: { name: INCIDENT_STREAM_NAME, prompt: INCIDENT_STREAM_PROMPT },
    });
    if (!created.ok) throw await failure(created, "creating the incident stream");
    incidentFeedId = z.object({ feed_id: z.string() }).parse(await created.json()).feed_id;
    await updateSettings({ incidentFeedId });
  } else {
    const resumed = await ambush(`/feeds/${incidentFeedId}`, { method: "PATCH", body: { status: "active" } });
    if (!resumed.ok) throw await failure(resumed, "resuming the incident stream");
  }
  // Routing the same pair again restores the route.
  const routed = await ambush(`/feeds/${incidentFeedId}/channels`, {
    method: "POST",
    body: { emission_channel_id: webhookId, ...ROUTE },
  });
  if (!routed.ok && routed.status !== 409) throw await failure(routed, "routing the incident stream");
  return incidentFeedId;
}

/** Subscribes the webhook to what the team chose, and stops what they didn't. */
export async function setAlertTopics(topics: AlertTopics): Promise<AlertTopics & { shadowUntil?: string }> {
  const settings = await readSettings();
  if (!settings.webhookId) throw new Error("Set up the channel first: say 'post alerts here'.");
  await setPackages(settings.webhookId, topics.packages);
  await setIncidents(settings.webhookId, topics.incidents);
  const shadowUntil =
    topics.incidents && !settings.incidentShadowUntil
      ? new Date(Date.now() + SHADOW_DAYS * 86_400_000).toISOString()
      : settings.incidentShadowUntil;
  await updateSettings({ alerts: topics, incidentShadowUntil: shadowUntil });
  return { ...topics, ...(topics.incidents && shadowUntil ? { shadowUntil } : {}) };
}
