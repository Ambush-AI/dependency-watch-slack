import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { readSettings } from "#lib/settings.ts";
import { postToChannel } from "#lib/slack.ts";

const sent = defineState("dependency-watch.notified", () => false);

export default defineTool({
  description:
    "Post the alert to the team's Slack channel. Only for a security report from Ambush; in a Slack conversation, reply normally instead. Call it at most once, last; to say nothing, don't call it.",
  inputSchema: z.object({ text: z.string().min(1) }),
  async execute({ text }, ctx) {
    if (ctx.session.auth.initiator?.authenticator !== "ambush") {
      return { sent: false, note: "Not an Ambush alert: reply in the thread instead." };
    }
    if (sent.get()) return { sent: false, note: "Already sent." };
    const { alertChannelId } = await readSettings();
    if (!alertChannelId) {
      return { sent: false, note: "No alert channel yet: someone has to say 'post alerts here' in Slack." };
    }
    await postToChannel(alertChannelId, text);
    sent.update(() => true);
    return { sent: true };
  },
});
