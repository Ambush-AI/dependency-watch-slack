import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { readSettings } from "#lib/settings.ts";
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
 * alerts in `data.items`.
 */
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("feed.news_item.test") }),
  z.object({ type: z.literal("feed.news_item.emitted"), id: z.string(), data: reportSchema }),
  z.object({
    type: z.literal("feed.news_items.emitted"),
    data: z.object({ items: z.array(itemSchema) }),
  }),
]);

const AMBUSH_AUTH = {
  authenticator: "ambush",
  principalType: "service",
  principalId: "ambush",
  attributes: {},
} as const;

export default defineChannel({
  routes: [
    POST("/ambush", async (request, { from }) => {
      const rawBody = await request.text();
      const verified = verifyStandardWebhook({
        rawBody,
        headers: request.headers,
        secret: (await readSettings()).webhookSecret,
      });
      if (!verified.ok) return new Response(verified.reason, { status: 401 });

      const event = eventSchema.safeParse(JSON.parse(rawBody));
      if (!event.success) return Response.json({ ignored: true });
      if (event.data.type === "feed.news_item.test") return Response.json({ ok: true });

      const alerts =
        event.data.type === "feed.news_item.emitted"
          ? [{ id: event.data.id, data: event.data.data }]
          : event.data.data.items;
      // Each alert gets its own session, keyed so a retried delivery doesn't
      // check it twice. Awaited before the 2xx so Ambush retries on failure.
      await Promise.all(
        alerts.map((alert) =>
          from(`alert:${alert.id}`).send(
            `Security report from Ambush:\n${JSON.stringify(alert.data, null, 2)}`,
            { auth: AMBUSH_AUTH, idempotencyKey: `ambush:${alert.id}` },
          ),
        ),
      );
      return Response.json({ accepted: alerts.length }, { status: 202 });
    }),
  ],
});
