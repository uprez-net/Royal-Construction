import { createHmac, timingSafeEqual } from "node:crypto";

// Signing what the bridge sends the app.
//
//   X-Bridge-Timestamp: <unix seconds>
//   X-Bridge-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
//
// The timestamp is inside the signature so a captured request cannot be
// replayed later: the app refuses one more than five minutes old. The app's
// verifier is lib/whatsapp-bridge/webhook-signature.ts; keep them identical.

export const SIGNATURE_HEADER = "x-bridge-signature";
export const TIMESTAMP_HEADER = "x-bridge-timestamp";
export const EVENT_ID_HEADER = "x-bridge-event-id";

export function signBody(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${mac}`;
}

/** Constant-time comparison, for the bridge's own tests and tools. */
export function verifySignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signBody(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
