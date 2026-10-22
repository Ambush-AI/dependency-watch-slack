import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ambush signs every delivery the Standard Webhooks way: an HMAC-SHA256 of
 * `id.timestamp.body` under the signing secret it showed you once.
 */

export function decodeSecret(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const key = Buffer.from(raw, "base64");
  // Ambush requires canonical base64 after whsec_; a plain string decodes to
  // garbage and every signature fails silently, so reject it here.
  return key.length > 0 && key.toString("base64") === raw ? key : null;
}

export function verifyStandardWebhook(input: {
  rawBody: string;
  headers: Headers;
  secret: string | undefined;
}): { ok: true; id: string } | { ok: false; reason: string } {
  const id = input.headers.get("webhook-id");
  const timestamp = input.headers.get("webhook-timestamp");
  const signature = input.headers.get("webhook-signature");
  if (!input.secret) return { ok: false, reason: "no signing secret yet: run setup in Slack first" };
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing webhook-* headers" };
  }

  const key = decodeSecret(input.secret);
  if (!key) return { ok: false, reason: "the stored signing secret is not whsec_<base64>" };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) {
    return { ok: false, reason: "webhook-timestamp is not an integer" };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return { ok: false, reason: "webhook-timestamp outside tolerance" };
  }

  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.${input.rawBody}`)
    .digest();
  // During a secret rotation the header carries several space-separated
  // "v1,<sig>" entries; any one matching is a pass.
  const matched = signature
    .split(" ")
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => Buffer.from(entry.slice(3), "base64"))
    .some(
      (candidate) =>
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
    );

  return matched
    ? { ok: true, id }
    : { ok: false, reason: "signature mismatch" };
}
