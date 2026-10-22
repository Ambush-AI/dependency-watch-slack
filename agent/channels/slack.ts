import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { slackCredentials } from "#lib/slack.ts";

export default slackChannel({
  credentials: slackCredentials,
  async onAppMention(ctx, message) {
    const auth = defaultSlackAuth(message, ctx);
    if (!auth) return null;
    await ctx.thread.startTyping("Checking...").catch(() => {});
    // watch_here needs to know which channel it was asked from.
    return {
      auth: { ...auth, attributes: { ...auth.attributes, slackChannelId: message.channelId } },
    };
  },
});
