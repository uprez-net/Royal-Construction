import { createHmac, timingSafeEqual } from "node:crypto";

// Verifying an event the WhatsApp bridge POSTed.
//
//   X-Bridge-Timestamp: <unix seconds>
//   X-Bridge-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
//
// keyed with WHATSAPP_BRIDGE_WEBHOOK_SECRET (the bridge's
// BRIDGE_WEBHOOK_SECRET). The timestamp is signed too, and one more than five
// minutes from now is refused, so a captured request cannot be replayed later.
// The bridge's signer is services/whatsapp-bridge/src/events/sign.ts; keep
// the two identical.
//
// Fails closed: no secret, no header, a malformed one, or a stale timestamp is
// a rejection. This route is on the open internet and writes messages onto a
// client's project.

export const BRIDGE_SIGNATURE_HEADER = "x-bridge-signature";
export const BRIDGE_TIMESTAMP_HEADER = "x-bridge-timestamp";
export const BRIDGE_EVENT_ID_HEADER = "x-bridge-event-id";
export const BRIDGE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signBridgeBody(
  secret: string,
  timestamp: number,
  rawBody: string | Uint8Array,
): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.`);
  if (typeof rawBody === "string") hmac.update(rawBody, "utf8");
  else hmac.update(rawBody);
  return `sha256=${hmac.digest("hex")}`;
}

export function verifyBridgeSignature(
  headers: Headers,
  rawBody: string | Uint8Array,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!secret) return false;
  const timestampText = headers.get(BRIDGE_TIMESTAMP_HEADER)?.trim() ?? "";
  if (!/^\d{9,11}$/.test(timestampText)) return false;
  const timestamp = Number(timestampText);
  if (Math.abs(nowMs / 1000 - timestamp) > BRIDGE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const presented = headers.get(BRIDGE_SIGNATURE_HEADER)?.trim() ?? "";
  if (!/^sha256=[0-9a-f]{64}$/i.test(presented)) return false;
  const expected = Buffer.from(
    signBridgeBody(secret, timestamp, rawBody).slice("sha256=".length),
    "hex",
  );
  const actual = Buffer.from(presented.slice("sha256=".length), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
