import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare secrets without exposing a length-dependent early return.
 *
 * Hashing first is what makes `timingSafeEqual` usable here at all: it throws
 * on differing lengths, and calling it on the raw strings would leak the
 * secret's length through that throw.
 *
 * Shared by the staging eval bootstrap and the WhatsApp webhook's
 * verify-token check. An empty or missing value on either side never matches,
 * so an unset secret fails closed.
 */
export function constantTimeSecretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
