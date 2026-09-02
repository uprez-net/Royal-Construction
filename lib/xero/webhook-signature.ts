import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Xero webhook payload against the configured webhook key.
 *
 * Xero signs each delivery with a single key and presents it base64-encoded in
 * `x-xero-signature`, computed as HMAC-SHA256 over the RAW request body. The
 * body must therefore be read with `request.text()` and verified before any
 * `JSON.parse` — re-serialising the parsed object changes the bytes and the
 * signature will never match.
 *
 * Unlike DocuSign (see `lib/docusign/connect-signature.ts`, which scans
 * `x-docusign-signature-1..N` because DocuSign supports concurrent keys during
 * rotation), Xero exposes exactly one key per webhook, so there is one header
 * to check.
 *
 * This check is also what Xero's "Intent To Receive" validation asserts: it
 * sends both a correctly-signed and an incorrectly-signed payload and refuses
 * to enable the webhook unless it gets 200 and 401 respectively.
 */
export function verifyXeroSignature(
  headers: Headers,
  rawBody: string,
  key: string,
): boolean {
  if (!key) {
    return false;
  }

  const presented = headers.get("x-xero-signature");
  if (!presented) {
    return false;
  }

  const expected = Buffer.from(
    createHmac("sha256", key).update(rawBody, "utf8").digest("base64"),
  );
  const actual = Buffer.from(presented);

  // `timingSafeEqual` throws on a length mismatch, so the length is compared
  // first. That comparison leaks only the length of an attacker-supplied
  // header, which they already know.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
