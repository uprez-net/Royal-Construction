import type { LeadStage } from "@prisma/client";

import { PIPELINE_STAGES } from "./pipeline-stages";

/** Follow-up widget outcomes. None of them moves a lead's stage any more. */
export type FollowupResponseOutcome = "yes" | "notRequired" | "reschedule";

export interface ResolveLeadStageArgs {
  /** Where the lead is right now. Null only if the row could not be read. */
  currentStage: LeadStage | null;
  /** Stage explicitly requested by the caller, already mapped to the Prisma enum. */
  requestedStage?: LeadStage;
  /**
   * True when this request schedules work: a follow-up date, a meeting date, or
   * a reschedule. Advances an early lead into DISCOVERY and does nothing else.
   */
  taskScheduled?: boolean;
}

/**
 * The single place that decides what stage a lead update lands on.
 *
 * Callers must derive `closeDatePatch` from THIS return value, never from the
 * requested stage. Two inputs used to be able to set the stage independently,
 * and `lib/data/leads.ts` wrote the explicit one, computed closeDatePatch from
 * it, then let the follow-up branch overwrite the stage. That saved rows whose
 * stage and close-date stamps described two different transitions:
 * `{stage: "Won", followupResponseOutcome: "reschedule"}` stored IN_FOLLOW_UP
 * with a fresh `wonAt`.
 *
 * A scheduled task no longer moves the stage at all, except to advance a lead
 * that has not reached DISCOVERY yet. Completing one does nothing to the stage;
 * it stamps followupCompletedAt or meetingCompletedAt instead.
 *
 * Returns `undefined` when the update should not write `stage`.
 */
export function resolveLeadStage({
  currentStage,
  requestedStage,
  taskScheduled,
}: ResolveLeadStageArgs): LeadStage | undefined {
  // A person choosing a stage always wins over anything inferred.
  if (requestedStage !== undefined) return requestedStage;

  // Booking work on a lead nobody has worked yet means Discovery has started.
  // Strictly an advance: a lead at Qualified or beyond keeps its stage, and a
  // closed lead is not dragged back open by a calendar action.
  if (
    taskScheduled &&
    currentStage !== null &&
    isBeforeDiscovery(currentStage)
  ) {
    return "DISCOVERY";
  }

  return undefined;
}

/**
 * Compared by probability, not by `order`.
 *
 * Order is a display sequence, and the retired stages sit at the end of it
 * while being worth 30% or 100%. A lead still holding IN_FOLLOW_UP before the
 * data migration runs must not be treated as earlier than Discovery and shoved
 * forward by an unrelated reschedule.
 */
function isBeforeDiscovery(stage: LeadStage): boolean {
  const def = PIPELINE_STAGES[stage];
  return (
    def.outcome === "OPEN" &&
    def.probability < PIPELINE_STAGES.DISCOVERY.probability
  );
}
