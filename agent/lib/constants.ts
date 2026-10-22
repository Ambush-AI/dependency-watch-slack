// The deploy button provisions both connectors and sets these. Without it,
// create them with `vercel connect create slack --triggers` and
// `vercel connect create github`, and put their UIDs here.
export const SLACK_CONNECTOR = process.env.SLACK_CONNECTOR ?? "slack/dependency-watch";
export const GITHUB_CONNECTOR = process.env.GITHUB_CONNECTOR ?? "github/dependency-watch";

export const AMBUSH_API = process.env.AMBUSH_API_BASE ?? "https://api.ambush.ai/api/v1";
export const ADVISORY_STREAM = "package-security-advisories";

/** Where Ambush delivers alerts: this deployment, or a tunnel locally. */
export function webhookUrl(): string | null {
  const host = process.env.PUBLIC_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  return `${host.startsWith("http") ? host : `https://${host}`}/ambush`;
}
