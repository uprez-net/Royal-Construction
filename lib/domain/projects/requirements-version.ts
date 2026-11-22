import { createHash } from "node:crypto";

// A fingerprint of a project's requirements as one caller was shown them
// (issue #562).
//
// The Overview saves `requirements` whole, so a save made from a copy that is
// out of date silently puts back what someone else changed. Comparing the
// project's `updatedAt` would also refuse saves after unrelated writes — a
// milestone status, a compliance step, a variation, a Xero contact — that bump
// the row and never touch the requirements. So the page is handed the
// fingerprint of the requirements it was shown (after redaction for that
// caller: a site manager's copy has no HBCF or commercials), sends it back with
// the save, and the save is refused only if the stored requirements, seen the
// same way, no longer match.

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value ?? null;
}

/** The same requirements, in any key order, give the same fingerprint. */
export function requirementsVersion(requirements: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(requirements)))
    .digest("hex")
    .slice(0, 24);
}
