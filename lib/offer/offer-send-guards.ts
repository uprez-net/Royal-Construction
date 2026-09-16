import { OfferStatus } from "@prisma/client";

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
