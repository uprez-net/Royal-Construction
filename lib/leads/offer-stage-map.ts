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
  // An offer exists but nothing has gone out. The deal is real enough to
  // qualify the lead and no further.
  PENDING: "QUALIFIED",

  // A price is in the customer's hands. That is what Quoted means.
  SENT: "QUOTED",
  OFFER_SENT: "QUOTED",

  // The customer has engaged with the price: signed the acceptance, agreed
  // terms, or moved on to tender and contract paperwork. All of that is
  // negotiation, and every one of these statuses comes after SENT, so none of
  // them may map below it.
  OFFER_SIGNED: "NEGOTIATING",
  AGREED: "NEGOTIATING",
  TENDER_DRAFT: "NEGOTIATING",
  TENDER_SENT: "NEGOTIATING",
  TENDER_SIGNED: "NEGOTIATING",
  CONTRACT_DRAFT: "NEGOTIATING",
  CONTRACT_SENT: "NEGOTIATING",

  // A decline is a setback, not a loss. Every one of these is revisable and the
  // offer state machine allows the deal to continue. Marking a lead LOST is a
  // human act that carries a reason, and nothing here can supply one.
  //
  // Each decline sits level with the paperwork it came from, never above it. An
  // offer decline follows OFFER_SENT, so it stays at QUOTED; a tender or
  // contract decline follows documents that are already NEGOTIATING. Putting
  // every decline at NEGOTIATING would have scored a declined offer at 70%
  // against 55% for one the customer is still reading, which means saying no
  // would raise the forecast.
  OFFER_DECLINED: "QUOTED",
  REJECTED: "QUOTED",
  TENDER_DECLINED: "NEGOTIATING",
  CONTRACT_DECLINED: "NEGOTIATING",

  // The contract is signed. This is the moment the deal is won. CONVERTED, not
  // WON: they are the same outcome to every calculation, but CONVERTED is the
  // only one of the two the stage picker offers, so writing WON would put a
  // badge on the lead that an operator can neither reproduce nor undo.
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

  // Won only moves forward. Out-of-order webhooks are normal, and a stale
  // CONTRACT_SENT arriving after CONTRACT_SIGNED must not reopen the deal.
  if (currentStage && isWonStage(currentStage) && !isWonStage(next)) return null;

  // Never overrule a human who has closed the deal as lost. They recorded a
  // reason; an offer status has none to offer.
  if (currentStage && isLostStage(currentStage)) return null;

  // Never walk an open lead backwards.
  //
  // While every non-terminal status mapped to NEGOTIATING, the top open stage,
  // this could not happen: the map only ever moved a lead up. Splitting the map
  // across QUALIFIED, QUOTED and NEGOTIATING removes that accident, and without
  // this guard an offer reset to PENDING would drop a lead in negotiation from
  // 70% to 40%, and every decline-and-revise cycle would bounce the stage.
  //
  // Compared by probability rather than by `order`, because order is a display
  // sequence: NO_RESPONSE sorts last at 13 but is worth nothing, and a stalled
  // lead must be free to re-enter the pipeline when an offer appears. Only OPEN
  // stages are held; STALLED is not a rung on the ladder.
  if (currentStage) {
    const from = stageDef(currentStage);
    if (from.outcome === "OPEN" && stageDef(next).probability < from.probability) {
      return null;
    }
  }

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
