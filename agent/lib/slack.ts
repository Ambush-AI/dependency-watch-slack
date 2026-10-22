import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi } from "eve/channels/slack";
import { SLACK_CONNECTOR } from "#lib/constants.ts";
import { readSettings, updateSettings } from "#lib/settings.ts";

export const slackCredentials = connectSlackCredentials(SLACK_CONNECTOR);

const KEEP_POSTS = 50;

/** Posts outside any Slack conversation, as alerts do, and remembers the post
 *  so a reply in its thread can start from it. */
export async function postToChannel(channel: string, text: string): Promise<void> {
  const response = await callSlackApi({
    botToken: slackCredentials.botToken,
    operation: "chat.postMessage",
    body: { channel, text, unfurl_links: false },
  });
  if (!response.ok) throw new Error(`Slack refused the post: ${String(response.error)}`);
  const ts = typeof response.ts === "string" ? response.ts : undefined;
  if (!ts) return;
  const { posts = [] } = await readSettings();
  await updateSettings({ posts: [...posts, { channel, ts, text }].slice(-KEEP_POSTS) });
}

/** The bot's own post that starts this thread, if it has one. */
export async function postInThread(channel: string, threadTs: string): Promise<string | undefined> {
  const { posts = [] } = await readSettings();
  return posts.find((post) => post.channel === channel && post.ts === threadTs)?.text;
}
