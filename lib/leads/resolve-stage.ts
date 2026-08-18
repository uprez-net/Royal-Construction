import type { LeadStage } from "@prisma/client";

import { PIPELINE_STAGES } from "./pipeline-stages";

/** Follow-up widget outcomes that can move a lead's stage as a side effect. */
export type FollowupResponseOutcome = "yes" | "notRequired" | "reschedule";

export interface ResolveLeadStageArgs {
  /** Where the lead is right now. Null only if the row could not be read. */
  currentStage: LeadStage | null;
  /** Stage explicitly requested by the caller, already mapped to the Prisma enum. */
  requestedStage?: LeadStage;
  followupResponseOutcome?: FollowupResponseOutcome;
}

/**
 * The single place that decides what stage a lead update lands on.
 *
 * Two independent inputs can set the stage — an explicit `stage` field and a
 * follow-up response action — and `updateLeadSchema` accepts them together.
 * Before this existed, `lib/data/leads.ts` wrote the explicit stage, computed
 * `closeDatePatch` from it, and THEN let the follow-up branch overwrite the
 * stage. That produced rows whose stage and close-date stamps described two
 * different transitions: `{stage: "Won", followupResponseOutcome: "reschedule"}`
 * saved stage IN_FOLLOW_UP with a fresh `wonAt`.
 *
 * Callers must derive `closeDatePatch` from THIS return value, never from the
 * requested stage.
 *
 * Returns `undefined` when the update should not write `stage` at all.
 */
export function resolveLeadStage({
  currentStage,
  requestedStage,
  followupResponseOutcome,
}: ResolveLeadStageArgs): LeadStage | undefined {
  let next = requestedStage;

  if (followupResponseOutcome === "yes" || followupResponseOutcome === "notRequired") {
    // Keyed off where the lead IS, not where this request is trying to put it.
    // This preserves the pre-existing guard exactly; an explicit stage sent in
    // the same payload still loses to it, as it always has.
    if (currentStage === "IN_FOLLOW_UP") next = "CONTACTED";
  } else if (followupResponseOutcome === "reschedule") {
    // Only reopen a live deal. Rescheduling a follow-up must never drag a WON
    // or LOST lead back to open: closeDatePatch would clear wonAt/lostAt and
    // silently rewrite win-rate history from a calendar action. Closing a deal
    // stays an explicit stage change.
    const effective = requestedStage ?? currentStage;
    if (effective === null || isReopenable(effective)) next = "IN_FOLLOW_UP";
  }

  return next;
}

function isReopenable(stage: LeadStage): boolean {
  const outcome = PIPELINE_STAGES[stage].outcome;
  return outcome === "OPEN" || outcome === "STALLED";
}
