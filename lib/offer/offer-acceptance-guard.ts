import { OfferStatus } from "@prisma/client";

/**
 * Why the offer document can't be sent for the customer's acceptance signature,
 * or null when it can.
 *
 * Written as a total map so the compiler catches a new OfferStatus that nobody
 * decided an answer for. The previous guard was a single `!== SENT` check that
 * printed the raw enum, which produced this for an offer already out for
 * signature:
 *
 *   "The offer can only be sent for signature once it has been sent to the
 *    client (current status: OFFER_SENT)."
 *
 * OFFER_SENT reads as "the offer has been sent", so the sentence denies its own
 * condition. An estimator can't act on that — and the message it replaces named
 * no next step for any of the eighteen states it could report.
 *
 * Every string below says what happened and what to do instead, in the words
 * the workspace already uses on its buttons.
 */
const BLOCKED: Record<OfferStatus, string | null> = {
  // The one state the acceptance send is for: issued to the client, not yet
  // out for signature.
  SENT: null,

  PENDING:
    "This offer hasn't gone to the client yet. Email the proposal first, then send it for signature.",
  SUPERSEDED:
    "This revision has been superseded by a newer one. Open the current revision and send that.",
  REJECTED:
    "This offer was marked rejected. Create a revision to send a new one.",

  OFFER_SENT:
    "This offer is already out for signature with the customer. Create a revision to replace it — that recalls the document first.",
  OFFER_SIGNED:
    // Two steps, not one: OFFER_SIGNED → AGREED, and the tender is drafted
    // from AGREED. "Mark it agreed to generate the tender" read as though
    // agreeing produced the document, so an estimator would go looking for a
    // tender that isn't drafted yet.
    "The customer has already signed this offer. Mark it agreed — the tender is drafted from there.",
  OFFER_DECLINED:
    "The customer declined this offer. Create a revision to send a new one.",

  // Past the acceptance step: the tender is the document in play, not the offer.
  ACCEPTED:
    "This offer has already been accepted. The tender is the next document to send.",
  AGREED:
    "This offer is already agreed. The tender is the next document to send.",
  TENDER_DRAFT:
    "This offer has moved on to the tender. Send the tender for signature instead.",
  TENDER_SENT: "The tender for this offer is already out for signature.",
  TENDER_DECLINED:
    "The customer declined the tender. Create a revision to start again.",
  TENDER_SIGNED:
    "The tender is signed. The contract is the next document, not the offer.",

  CONTRACT_DRAFT:
    "This offer is at the contract stage. Changes now need a contract variation.",
  CONTRACT_SENT:
    "The contract is out for signature. Changes now need a contract variation.",
  CONTRACT_DECLINED:
    "The customer declined the contract. That is handled on the contract, not by re-sending the offer.",
  CONTRACT_SIGNED:
    "The contract is signed. Changes now need a contract variation.",
  PROJECT:
    "This offer has been handed off to a project. Changes now need a contract variation.",
};

export function describeAcceptanceSendBlock(
  status: OfferStatus,
): string | null {
  return BLOCKED[status];
}

export function canSendOfferForAcceptance(status: OfferStatus): boolean {
  return BLOCKED[status] === null;
}
