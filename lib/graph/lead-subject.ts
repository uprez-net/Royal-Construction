/**
 * Which inbound email subjects create a lead, and the one definition of how a
 * subject is normalized before matching.
 *
 * These two were separate once: a normalizer stripped quotes while the
 * allowlist still contained `'"i want to build" form submission'` with literal
 * quotes. Every enquiry from that form normalized to something the set did not
 * contain, so it was logged and skipped and no lead row was ever created —
 * silently, since a non-matching subject is the ordinary case for most mail.
 *
 * Keeping the list and the normalizer together, with the assertion below, is
 * what stops them drifting apart again.
 */

/** Lower case, quote-free, single-spaced. */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ");
}

/** Subjects that identify a website enquiry, in normalized form. */
export const LEAD_SUBJECT_LINES = new Set([
  "i want to build form submission",
  "get in touch form submission",
  "general enquiry form submission",
  "new message from royal constructions",
]);

// The set has no compiler to check it. Assert at module load that every entry
// is already normalized — an entry that is not can never match anything.
for (const line of LEAD_SUBJECT_LINES) {
  if (normalizeSubject(line) !== line) {
    throw new Error(
      `LEAD_SUBJECT_LINES entry is not normalized and can never match: "${line}"`,
    );
  }
}

/** Does this inbound subject identify a website enquiry? */
export function isLeadSubject(subject: string | null | undefined): boolean {
  return LEAD_SUBJECT_LINES.has(normalizeSubject(subject));
}
