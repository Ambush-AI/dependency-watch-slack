import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { postInThread, slackCredentials } from "#lib/slack.ts";

export default slackChannel({
  credentials: slackCredentials,
  async onAppMention(ctx, message) {
    const auth = defaultSlackAuth(message, ctx);
    if (!auth) return null;
    await ctx.thread.startTyping("Checking...").catch(() => {});
    // watch_here needs to know which channel it was asked from.
    const withChannel = {
      ...auth,
      attributes: { ...auth.attributes, slackChannelId: message.channelId },
    };
    // Alerts are posted outside any conversation, and the app can't read
    // channel history, so a reply under one starts from the alert itself.
    const alert =
      message.threadTs && message.threadTs !== message.ts
        ? await postInThread(message.channelId, message.threadTs)
        : undefined;
    return alert
      ? { auth: withChannel, history: [{ role: "assistant", text: alert }] }
      : { auth: withChannel };
  },
});
