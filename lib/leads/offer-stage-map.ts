import type { LeadStage, OfferStatus } from "@prisma/client";

import { closeDatePatch, stageDef } from "./pipeline-stages";

/**
 * What an offer's status implies about its lead's stage.
 *
 * This exists because the modern offer lifecycle never touched Lead.stage. A
 * deal could go offer → agreed → tender signed → contract signed → live
 * project while its lead sat wherever a human last dragged it. On staging that
 * meant four signed-or-building deals and not one lead at WON, including a
 * live project worth $945k whose lead read "Meeting Scheduled". Win rate
 * under-counted every win; open pipeline counted won work as still open.
 *
 * `null` means "this status says nothing about the lead" — the caller must
 * leave the stage alone. That is a real answer, not a gap: SUPERSEDED happens
 * when a revision replaces an offer, which tells you nothing about whether the
 * customer is closer to signing.
 *
 * Pure, total over OfferStatus, and deliberately in a directive-free module:
 * lib/data/offers.ts and the other offer modules are all `"use server"`, which
 * permits only async exports, so a map living there cannot be unit-tested at
 * all. That is how the previous version of this map went 14/18 unreachable
 * without anyone noticing.
 */
export const OFFER_STATUS_LEAD_STAGE: Record<OfferStatus, LeadStage | null> = {
  // Nothing has been agreed yet, but the deal is live and being worked.
  PENDING: "NEGOTIATING",
  SENT: "NEGOTIATING",
  OFFER_SENT: "NEGOTIATING",
  OFFER_SIGNED: "NEGOTIATING",
  AGREED: "NEGOTIATING",
  TENDER_DRAFT: "NEGOTIATING",
  TENDER_SENT: "NEGOTIATING",
  TENDER_SIGNED: "NEGOTIATING",
  CONTRACT_DRAFT: "NEGOTIATING",
  CONTRACT_SENT: "NEGOTIATING",

  // A decline is a setback, not a loss — every one of these is revisable, and
  // the offer state machine allows the deal to continue. Marking a lead LOST
  // is a human act that carries a reason (see lib/data/leads.ts), and nothing
  // here can supply one.
  OFFER_DECLINED: "NEGOTIATING",
  TENDER_DECLINED: "NEGOTIATING",
  CONTRACT_DECLINED: "NEGOTIATING",
  REJECTED: "NEGOTIATING",

  // The contract is signed. This is the moment the deal is won. CONVERTED, not
  // WON: they are the same outcome to every calculation, but CONVERTED is the
  // only one of the two the stage picker offers, so writing WON here would put
  // a badge on the lead that an operator can neither reproduce nor undo.
  CONTRACT_SIGNED: "CONVERTED",
  // Work has started. Still won; the stage must not move backwards.
  PROJECT: "CONVERTED",

  // A revision replaced this offer. Says nothing about the customer.
  SUPERSEDED: null,
  // Terminal legacy accept, kept because the enum still carries it.
  ACCEPTED: "CONVERTED",
};

export interface LeadStagePatch {
  stage: LeadStage;
  wonAt?: Date | null;
  lostAt?: Date | null;
}

/**
 * The lead write implied by an offer reaching `status`, or null for no change.
 *
 * A pure projection of (status, currentStage): applying it twice is the same
 * as applying it once, which is what makes the DocuSign webhook safe to replay
 * without a dedupe table. `closeDatePatch` already returns `{}` when the stage
 * does not move.
 *
 * Never moves a lead OUT of a won stage. A late or replayed event for an
 * earlier status must not un-win a deal that has since been signed.
 */
export function leadStagePatchForOfferStatus(
  status: OfferStatus,
  currentStage: LeadStage | null,
  now: Date,
  /**
   * The lead's existing wonAt, so a lead that is already won can have one
   * stamped if it never got one. CONVERTED pre-dates the column, so a legacy
   * converted lead whose contract signs would otherwise stay invisible to win
   * rate — won by every other measure, uncounted.
   *
   * Required, not defaulted: null here means "never stamped", which now causes
   * a write. A caller that forgot the argument would silently re-date the win.
   */
  currentWonAt: Date | null,
): LeadStagePatch | null {
  const next = OFFER_STATUS_LEAD_STAGE[status];
  if (next === null) return null;

  // Already won, under either name. WON and CONVERTED are the same outcome, so
  // there is nothing to gain by shuffling a lead between them — and doing so
  // would rewrite the badge on historical rows the sync has no business
  // touching. The one thing still worth writing is a wonAt that was never
  // stamped: CONVERTED pre-dates the column, and a legacy converted lead is won
  // by every other measure while staying invisible to win rate.
  if (currentStage && isWonStage(currentStage) && isWonStage(next)) {
    return currentWonAt == null
      ? { stage: currentStage, wonAt: now, lostAt: null }
      : null;
  }

  if (currentStage === next) return null;

  // Won is a ratchet. Out-of-order webhooks are normal, and a stale
  // CONTRACT_SENT arriving after CONTRACT_SIGNED must not reopen the deal.
  if (currentStage && isWonStage(currentStage) && !isWonStage(next)) return null;

  // Never overrule a human who has closed the deal as lost. They recorded a
  // reason; an offer status has none to offer.
  if (currentStage && isLostStage(currentStage)) return null;

  const patch: LeadStagePatch = { stage: next, ...closeDatePatch(currentStage, next, now) };
  if (isWonStage(next) && patch.wonAt == null && currentWonAt == null) {
    patch.wonAt = now;
    patch.lostAt = null;
  }
  return patch;
}

// Derived from the stage ladder rather than re-listed. A new enum member gets
// the right treatment automatically, and PIPELINE_STAGES is a total Record so
// adding one without a definition is a compile error.
function isWonStage(stage: LeadStage): boolean {
  return stageDef(stage).outcome === "WON";
}

function isLostStage(stage: LeadStage): boolean {
  return stageDef(stage).outcome === "LOST";
}
