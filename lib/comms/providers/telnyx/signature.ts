import { createPublicKey, verify, type KeyObject } from "node:crypto";

// Telnyx's webhook signature (file 07 §2).
//
// `telnyx-signature-ed25519` is a base64 Ed25519 signature over
// "<telnyx-timestamp>|<raw body>", checked with the account's public key.
// Rejected when the timestamp is more than five minutes from now, which is
// Telnyx's replay protection. The raw bytes are verified, never a re-serialised
// object.
//
// VERIFY: confirm against a delivery copied from Mission Control before relying
// on it in production (tests/comms/telnyx-signature.test.ts uses a generated key).

export const TELNYX_SIGNATURE_HEADER = "telnyx-signature-ed25519";
export const TELNYX_TIMESTAMP_HEADER = "telnyx-timestamp";
export const TELNYX_TOLERANCE_SECONDS = 300;

/** A raw 32-byte Ed25519 key becomes SPKI DER with this fixed prefix. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const keys = new Map<string, KeyObject | null>();

/** Null when the configured key is not a 32-byte Ed25519 key: a config error. */
export function telnyxPublicKey(base64: string): KeyObject | null {
  if (keys.has(base64)) return keys.get(base64) ?? null;
  let key: KeyObject | null = null;
  const raw = Buffer.from(base64, "base64");
  if (raw.length === 32) {
    try {
      key = createPublicKey({ format: "der", key: Buffer.concat([SPKI_PREFIX, raw]), type: "spki" });
    } catch {
      key = null;
    }
  }
  keys.set(base64, key);
  return key;
}

export function verifyTelnyxSignature(input: {
  readonly headers: Headers;
  readonly rawBody: string;
  readonly publicKey: string | null;
  readonly now: Date;
}): boolean {
  const signature = input.headers.get(TELNYX_SIGNATURE_HEADER)?.trim();
  const timestamp = input.headers.get(TELNYX_TIMESTAMP_HEADER)?.trim();
  if (!signature || !timestamp || !input.publicKey || !/^\d{1,12}$/.test(timestamp)) return false;
  const age = Math.abs(input.now.getTime() / 1000 - Number(timestamp));
  if (age > TELNYX_TOLERANCE_SECONDS) return false;
  const key = telnyxPublicKey(input.publicKey);
  if (!key) return false;
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64) return false;
  try {
    return verify(null, Buffer.from(`${timestamp}|${input.rawBody}`, "utf8"), key, bytes);
  } catch {
    return false;
  }
}
