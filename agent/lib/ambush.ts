import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ADVISORY_STREAM, AMBUSH_API } from "#lib/constants.ts";
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
 * Points an Ambush webhook at this deployment and subscribes it to Package
 * Security Advisories. Safe to run again: it reuses the webhook it made, and
 * an existing subscription counts as done.
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

  const subscribe = await ambush(`/feed-templates/${ADVISORY_STREAM}/subscriptions`, {
    method: "POST",
    body: { emission_channel_id: webhookId, minimum_delivery_interval_minutes: 1 },
  });
  if (!subscribe.ok && subscribe.status !== 409) {
    throw await failure(subscribe, "subscribing to Package Security Advisories");
  }
  return { webhookId, created };
}
