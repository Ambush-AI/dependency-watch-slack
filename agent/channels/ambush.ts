import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { readSettings, type Settings } from "#lib/settings.ts";
import { verifyStandardWebhook } from "#lib/standard-webhooks.ts";

const reportSchema = z.object({
  headline: z.string(),
  summary: z.string().nullish(),
  source: z.string().nullish(),
  url: z.string().nullish(),
});
const itemSchema = z.object({ id: z.string(), data: reportSchema });

/**
 * One alert is `feed.news_item.emitted`, the report in `data`; a subscription
 * with a delivery interval batches them as `feed.news_items.emitted`, the
 * alerts in `data.items`. `feed_id` says which stream sent it.
 */
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("feed.news_item.test") }),
  z.object({
    type: z.literal("feed.news_item.emitted"),
    id: z.string(),
    feed_id: z.string().optional(),
    data: reportSchema,
  }),
  z.object({
    type: z.literal("feed.news_items.emitted"),
    feed_id: z.string().optional(),
    data: z.object({ items: z.array(itemSchema) }),
  }),
]);

type Stream = "package" | "incident";

const authFor = (stream: Stream) => ({
  authenticator: "ambush",
  principalType: "service",
  principalId: "ambush",
  attributes: { stream },
});

const WEEK_MS = 7 * 86_400_000;

/** What the bot already raised about incidents this week, posted or held
 *  back, so a second report of the same incident isn't raised again. */
function recentIncidents(settings: Settings): string[] {
  const since = Date.now() - WEEK_MS;
  const posted = (settings.posts ?? [])
    .filter((post) => post.kind === "incident" && post.at && Date.parse(post.at) > since)
    .map((post) => post.text);
  const held = (settings.shadowLog ?? []).filter((entry) => Date.parse(entry.at) > since).map((entry) => entry.text);
  return [...posted, ...held].map((text) => text.split("\n")[0] ?? text);
}

function message(stream: Stream, report: z.infer<typeof reportSchema>, settings: Settings): string {
  if (stream === "package") return `Security report from Ambush:\n${JSON.stringify(report, null, 2)}`;
  const raised = recentIncidents(settings);
  return [
    `Major incident report from Ambush:\n${JSON.stringify(report, null, 2)}`,
    raised.length > 0
      ? `Incidents you already raised this week (raise this only if it's a different incident, or a material update to one):\n${raised.map((line) => `- ${line}`).join("\n")}`
      : "You haven't raised any incidents this week.",
  ].join("\n\n");
}

export default defineChannel({
  routes: [
    POST("/ambush", async (request, { from }) => {
      const rawBody = await request.text();
      const settings = await readSettings();
      const verified = verifyStandardWebhook({
        rawBody,
        headers: request.headers,
        secret: settings.webhookSecret,
      });
      if (!verified.ok) return new Response(verified.reason, { status: 401 });

      const event = eventSchema.safeParse(JSON.parse(rawBody));
      if (!event.success) return Response.json({ ignored: true });
      if (event.data.type === "feed.news_item.test") return Response.json({ ok: true });

      const stream: Stream =
        settings.incidentFeedId && event.data.feed_id === settings.incidentFeedId ? "incident" : "package";
      const alerts =
        event.data.type === "feed.news_item.emitted"
          ? [{ id: event.data.id, data: event.data.data }]
          : event.data.data.items;
      // Each alert gets its own session, keyed so a retried delivery doesn't
      // check it twice. Awaited before the 2xx so Ambush retries on failure.
      await Promise.all(
        alerts.map((alert) =>
          from(`alert:${alert.id}`).send(message(stream, alert.data, settings), {
            auth: authFor(stream),
            idempotencyKey: `ambush:${alert.id}`,
          }),
        ),
      );
      return Response.json({ accepted: alerts.length }, { status: 202 });
    }),
  ],
});
