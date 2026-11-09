import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a WhatsApp webhook delivery against the Meta app secret.
 *
 * Meta signs every POST with `X-Hub-Signature-256: sha256=<hex>`, an
 * HMAC-SHA256 of the RAW request body keyed with the app secret. Pass the bytes
 * exactly as received, and verify before any `JSON.parse`: re-serialising a
 * parsed object changes the bytes and the signature never matches.
 *
 * Fails closed: no secret, no header, a header without the `sha256=` prefix or
 * a digest of the wrong length is a rejection. This route is on the open
 * internet and writes customer messages onto leads, so "we could not check" is
 * never "accept".
 */
export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";

export function verifyWhatsAppSignature(
  headers: Headers,
  rawBody: string | Uint8Array,
  appSecret: string | null | undefined,
): boolean {
  if (!appSecret) return false;

  const presented = headers.get(WHATSAPP_SIGNATURE_HEADER)?.trim();
  if (!presented?.toLowerCase().startsWith("sha256=")) return false;
  const presentedHex = presented.slice("sha256=".length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(presentedHex)) return false;

  const hmac = createHmac("sha256", appSecret);
  if (typeof rawBody === "string") hmac.update(rawBody, "utf8");
  else hmac.update(rawBody);
  const expected = hmac.digest();
  const actual = Buffer.from(presentedHex, "hex");

  // Both are 32 bytes by now, so timingSafeEqual cannot throw on length.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
