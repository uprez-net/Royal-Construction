import { OfferStatus } from "@prisma/client";

import { isValidIsoCalendarDate, sydneyToday } from "@/lib/dates/sydney";

// Directive-free so the send guards can be unit-tested without a "use server"
// module or Prisma's client.

// The proposal email is the negotiation document: it goes out while the offer
// is pending, and again while it is being negotiated. sendOfferDocument checked
// nothing about status, so a stale tab or a direct call could email a proposal
// for an offer already agreed, out for signature, or superseded, quoting
// whatever the workspace held while the Tender or Contract said otherwise.
const PROPOSAL_EMAIL_STATUSES: ReadonlySet<OfferStatus> = new Set([
  OfferStatus.PENDING,
  OfferStatus.SENT,
]);

export function canEmailOfferProposal(status: OfferStatus): boolean {
  return PROPOSAL_EMAIL_STATUSES.has(status);
}

export const PROPOSAL_STAGE_PASSED_ERROR =
  "This offer has moved past the proposal stage.";

/**
 * Why an offer cannot go out with this validity date, or null when it can.
 *
 * Every client document states how long the price holds. A blank date printed
 * "firm until , subject to…" on the Tender and fell back to a sample "valid for
 * 30 days" in the proposal email, while a past date told the client the offer
 * had already lapsed (#534). Today still counts as valid, and "today" is
 * Sydney's: a server in UTC is a day behind until 11am.
 */
export function offerValidityIssue(
  validUntil: string,
  now: Date = new Date(),
): string | null {
  const day = validUntil.trim();
  if (!isValidIsoCalendarDate(day)) {
    return "Set a validity date before sending: the documents say how long the price holds. Set it in Job setup while the offer is pending, or create a new revision once it has been sent or agreed.";
  }
  if (day < sydneyToday(now)) {
    return `The validity date (${day}) has passed. Extend it in Job setup while the offer is pending, or create a new revision once it has been sent or agreed.`;
  }
  return null;
}
