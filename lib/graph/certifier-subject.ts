import { randomBytes } from "node:crypto";

// Pure correlation for certifier mail. Deliberately free of prisma and of the
// Graph client, so it can be unit-tested against captured subject lines —
// the same split lib/graph/offer-reply-classify.ts makes for offer replies.

// The outreach subject carries "[RCCERT-<12 hex>]", and every reply keeps it
// through "Re: …" and "Fw: …" because mail clients quote the subject verbatim.
// That token is what ties an inbound message back to its engagement, and it is
// checked instead of the sender address on purpose: a certifier's office
// answers from whichever address happens to pick the job up.
//
// Case-insensitive on the prefix as well as the hex, which the offer token
// regex is not: subjects come back through mail clients and ticketing systems
// that lower-case them, and the stored refToken is upper-case, so a
// case-sensitive prefix would orphan the whole thread over a cosmetic change.
const CERTIFIER_TOKEN_RE = /\[(RCCERT-[0-9A-F]{12})\]/i;

/**
 * The engagement token quoted in a subject line, or null.
 *
 * Scans rather than anchors, so any number of "Re:"/"Fw:"/"FW: Re:" prefixes —
 * and a certifier who retypes the subject with the token still on it — all
 * resolve. Returned upper-cased so a client that lower-cased the subject still
 * matches the stored refToken.
 */
export function extractCertifierRefToken(
  subject: string | undefined | null,
): string | null {
  if (!subject) {
    return null;
  }
  const match = CERTIFIER_TOKEN_RE.exec(subject);
  return match ? match[1].toUpperCase() : null;
}

/**
 * A fresh engagement token.
 *
 * Six random bytes, matching the RCOFR- tokens minted in lib/data/offer-send.ts.
 * It is not a secret — it appears in a subject line — it only has to be
 * unguessable enough that two live engagements never collide.
 */
export function generateCertifierRefToken(): string {
  return `RCCERT-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * The subject a certifier thread is opened with.
 *
 * The token goes first so it survives a client that truncates a long subject,
 * and the address follows so a human scanning their inbox can tell one job
 * from another without opening anything.
 */
export function buildCertifierSubject(
  refToken: string,
  subjectAddress: string,
): string {
  return `[${refToken}] ${subjectAddress}`.trim();
}

/**
 * The subject for a reply on an existing thread.
 *
 * Prefixed once: a thread that has been round-tripped a few times already
 * carries "Re:", and stacking another on every send makes the subject unusable
 * long before the engagement is finished.
 */
export function buildCertifierReplySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}
