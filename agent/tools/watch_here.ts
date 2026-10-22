import { defineTool } from "eve/tools";
import { z } from "zod";
import { connectToAmbush } from "#lib/ambush.ts";
import { webhookUrl } from "#lib/constants.ts";
import { availableRepos } from "#lib/github.ts";
import { updateSettings } from "#lib/settings.ts";
import { postToChannel } from "#lib/slack.ts";

// Posted the way a real alert is, so setup proves alerts can reach the channel.
const SAMPLE_ALERT = [
  "*Sample alert, nothing to fix.* Real alerts look like this:",
  "Heads up, worth fixing today: a high-severity flaw in gatsby-transformer-remark lets crafted Markdown run code during your build (CVE-2023-22491). acme/site uses 2.6.22 directly, and OSV confirms it's affected. The fix is 5.25.1, a major-version jump, so expect some code changes.",
].join("\n");

export default defineTool({
  description:
    "Make the Slack channel this conversation is in the place alerts go, connect Dependency Watch to Ambush's security advisory stream, and post a sample alert there. Use it when someone asks you to post alerts here, or to set up or reconnect. Safe to run again.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const channelId = ctx.session.auth.current?.attributes.slackChannelId;
    if (typeof channelId !== "string") {
      return { ok: false, why: "Ask me from the Slack channel the alerts should go to." };
    }
    const url = webhookUrl();
    if (!url) return { ok: false, why: "This deployment doesn't know its public URL." };
    await updateSettings({ alertChannelId: channelId });
    const ambush = await connectToAmbush(url);
    await postToChannel(channelId, SAMPLE_ALERT, "sample");
    return {
      ok: true,
      alertChannelId: channelId,
      sampleAlertPosted: true,
      repoCount: (await availableRepos()).length,
      ambush,
      next: "Call choose_repos, then choose_alerts.",
    };
  },
});
