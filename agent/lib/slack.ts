import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi } from "eve/channels/slack";
import { SLACK_CONNECTOR } from "#lib/constants.ts";

export const slackCredentials = connectSlackCredentials(SLACK_CONNECTOR);

/** Posts outside any Slack conversation, as alerts do. */
export async function postToChannel(channel: string, text: string): Promise<void> {
  const response = await callSlackApi({
    botToken: slackCredentials.botToken,
    operation: "chat.postMessage",
    body: { channel, text, unfurl_links: false },
  });
  if (!response.ok) throw new Error(`Slack refused the post: ${String(response.error)}`);
}
