import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { readSettings, updateSettings } from "#lib/settings.ts";
import { postToChannel } from "#lib/slack.ts";

const sent = defineState("dependency-watch.notified", () => false);
const KEEP_SHADOW = 100;

export default defineTool({
  description:
    "Post the alert to the team's Slack channel. Only for a report from Ambush; in a Slack conversation, reply normally instead. Call it at most once, last; to say nothing, don't call it.",
  inputSchema: z.object({ text: z.string().min(1) }),
  async execute({ text }, ctx) {
    const initiator = ctx.session.auth.initiator;
    if (initiator?.authenticator !== "ambush") {
      return { sent: false, note: "Not an Ambush alert: reply in the thread instead." };
    }
    if (sent.get()) return { sent: false, note: "Already sent." };
    const kind = initiator.attributes.stream === "incident" ? "incident" : "package";
    const settings = await readSettings();
    if (kind === "incident" && settings.incidentShadowUntil && Date.now() < Date.parse(settings.incidentShadowUntil)) {
      const entry = { at: new Date().toISOString(), text };
      await updateSettings({ shadowLog: [...(settings.shadowLog ?? []), entry].slice(-KEEP_SHADOW) });
      sent.update(() => true);
      return { sent: false, heldBack: true, note: "Trial week: logged instead of posted." };
    }
    if (!settings.alertChannelId) {
      return { sent: false, note: "No alert channel yet: someone has to say 'post alerts here' in Slack." };
    }
    await postToChannel(settings.alertChannelId, text, kind);
    sent.update(() => true);
    return { sent: true };
  },
});
