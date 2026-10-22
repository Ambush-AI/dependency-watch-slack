import { readFile, writeFile } from "node:fs/promises";
import { get, put } from "@vercel/blob";
import { z } from "zod";

/** What setup in Slack decides, kept across deploys and cold starts. */
const settingsSchema = z.object({
  alertChannelId: z.string().optional(),
  webhookSecret: z.string().optional(),
  webhookId: z.string().optional(),
  webhookUrl: z.string().optional(),
  /** Which repos to check. Unset means every repo the GitHub App can see. */
  watch: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("all") }),
      z.object({ mode: z.literal("list"), repos: z.array(z.string()) }),
    ])
    .optional(),
  /** What the bot posted on its own, newest last, so a reply in one of those
   *  threads starts with the post it replies to. */
  posts: z
    .array(
      z.object({
        channel: z.string(),
        ts: z.string(),
        text: z.string(),
        kind: z.enum(["package", "incident", "sample"]).optional(),
        at: z.string().optional(),
      }),
    )
    .optional(),
  /** What to alert on. Unset means packages only, as before this was asked. */
  alerts: z.object({ packages: z.boolean(), incidents: z.boolean() }).optional(),
  incidentFeedId: z.string().optional(),
  /** Until then, incident posts go to `shadowLog` instead of Slack. */
  incidentShadowUntil: z.string().optional(),
  shadowLog: z.array(z.object({ at: z.string(), text: z.string() })).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

const BLOB_PATH = "dependency-watch/settings.json";
const LOCAL_PATH = ".settings.json";

// The deploy button provisions a private Blob store, reached by store id over
// Vercel OIDC (or a read-write token); `eve dev` without one keeps settings
// in a local file.
const useBlob = () =>
  Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

async function readRaw(): Promise<string | null> {
  if (!useBlob()) return readFile(LOCAL_PATH, "utf8").catch(() => null);
  const result = await get(BLOB_PATH, { access: "private", useCache: false });
  return result ? new Response(result.stream).text() : null;
}

export async function readSettings(): Promise<Settings> {
  const raw = await readRaw();
  if (!raw) return {};
  const parsed = settingsSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : {};
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  const body = JSON.stringify(next);
  if (useBlob()) {
    await put(BLOB_PATH, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } else {
    await writeFile(LOCAL_PATH, body, { mode: 0o600 });
  }
  return next;
}
