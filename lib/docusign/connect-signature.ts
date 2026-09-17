import { createHmac, timingSafeEqual } from "node:crypto";

// Max concurrent Connect HMAC keys to look for. DocuSign's own limit is small;
// bounding the scan keeps a hostile caller from making us compare against dozens
// of attacker-supplied header values.
const MAX_SIGNATURE_HEADERS = 10;

/**
 * Verify a DocuSign Connect payload against the configured HMAC secret.
 *
 * DocuSign supports SEVERAL concurrent Connect HMAC keys — that is how a key is
 * rotated without downtime — and signs each delivery with EVERY active key,
 * emitting one header per key: `x-docusign-signature-1`, `-2`, `-3`, …
 *
 * Reading only `-1` therefore breaks the moment a second key is added: `-1`
 * carries the OLD key's signature while the environment holds the NEW secret, so
 * every callback is rejected with 401. That was observed on staging — the Connect
 * webhook 401'd continuously after a key was *added* (not replaced), which stalls
 * signature sync, leaves tender/contract status stuck, and prevents the executed
 * PDF from being archived.
 *
 * The payload is authentic if it matches ANY presented signature.
 */
export function verifyConnectSignature(
  headers: Headers,
  rawBody: string,
  key: string,
): boolean {
  if (!key) {
    return false;
  }
  const expected = Buffer.from(
    createHmac("sha256", key).update(rawBody, "utf8").digest("base64"),
  );

  // Check every candidate without an early return, so the time taken does not
  // reveal WHICH key matched. The HMAC itself is computed once, above.
  let matched = false;
  for (let i = 1; i <= MAX_SIGNATURE_HEADERS; i += 1) {
    const presented = headers.get(`x-docusign-signature-${i}`);
    if (!presented) {
      continue;
    }
    const actual = Buffer.from(presented);
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      matched = true;
    }
  }
  return matched;
}
