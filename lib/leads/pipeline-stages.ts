import type { LeadStage } from "@prisma/client";

/**
 * What a stage means for pipeline maths.
 * - OPEN    — live deal; counts in open pipeline and weighted pipeline.
 * - WON     — closed successfully; counts in win rate and banked.
 * - LOST    — closed unsuccessfully; counts in win rate only.
 * - STALLED — went quiet without a decision. Counts in NOTHING: it is not a
 *   loss (see lib/data/leads.ts, whose lost counts already exclude
 *   NO_RESPONSE) and it must not inflate open pipeline value.
 */
export type StageOutcome = "OPEN" | "WON" | "LOST" | "STALLED";

export interface PipelineStageDef {
  code: LeadStage;
  label: string;
  /** Display order, 1-based, ascending through the funnel. */
  order: number;
  /** Default likelihood 0-100. Overridable per lead. */
  probability: number;
  outcome: StageOutcome;
  /**
   * Counts toward "Banked this quarter" — money considered in the bag.
   *
   * Won outcomes only. NEGOTIATING used to be banked, which meant sending an
   * offer booked 100% of the deal's face value into the card before the
   * customer had agreed to anything.
   */
  banked: boolean;
  /** CSS custom property used by the stage chart. */
  colorVar: string;
}

/**
 * Typed as a total Record so that adding a LeadStage enum member without a
 * definition here is a compile error rather than a runtime hole.
 */
export const PIPELINE_STAGES: Record<LeadStage, PipelineStageDef> = {
  NEW:               { code: "NEW",               label: "New",               order: 1,  probability: 10,  outcome: "OPEN",    banked: false, colorVar: "--stage-1" },
  CONTACTED:         { code: "CONTACTED",         label: "Contacted",         order: 2,  probability: 20,  outcome: "OPEN",    banked: false, colorVar: "--stage-2" },
  MEETING_SCHEDULED: { code: "MEETING_SCHEDULED", label: "Meeting Scheduled", order: 3,  probability: 30,  outcome: "OPEN",    banked: false, colorVar: "--stage-3" },
  QUALIFIED:         { code: "QUALIFIED",         label: "Qualified",         order: 4,  probability: 40,  outcome: "OPEN",    banked: false, colorVar: "--stage-4" },
  IN_FOLLOW_UP:      { code: "IN_FOLLOW_UP",      label: "In Follow-up",      order: 5,  probability: 45,  outcome: "OPEN",    banked: false, colorVar: "--stage-5" },
  QUOTED:            { code: "QUOTED",            label: "Quoted",            order: 6,  probability: 55,  outcome: "OPEN",    banked: false, colorVar: "--stage-6" },
  NEGOTIATING:       { code: "NEGOTIATING",       label: "Negotiating",       order: 7,  probability: 70,  outcome: "OPEN",    banked: false, colorVar: "--stage-7" },
  WON:               { code: "WON",               label: "Won",               order: 8,  probability: 100, outcome: "WON",     banked: true,  colorVar: "--stage-7" },
  // Retired stage. Kept only because this Record is keyed by the generated
  // Prisma enum, which still has CONVERTED until the phase B migration. It is
  // unreachable from the UI (no entry in stageToPrismaMap) and stageMap renders
  // any surviving row as "Won". Delete this entry in phase B, and renumber the
  // orders below to stay contiguous.
  CONVERTED:         { code: "CONVERTED",         label: "Won",               order: 9,  probability: 100, outcome: "WON",     banked: true,  colorVar: "--stage-7" },
  LOST:              { code: "LOST",              label: "Lost",              order: 10, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  CANCELLED:         { code: "CANCELLED",         label: "Cancelled",         order: 11, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  DISQUALIFIED:      { code: "DISQUALIFIED",      label: "Disqualified",      order: 12, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  NO_RESPONSE:       { code: "NO_RESPONSE",       label: "No Response",       order: 13, probability: 0,   outcome: "STALLED", banked: false, colorVar: "--stage-1" },
};

export function stageDef(code: LeadStage): PipelineStageDef {
  return PIPELINE_STAGES[code];
}

export function isOpenStage(code: LeadStage): boolean {
  return PIPELINE_STAGES[code].outcome === "OPEN";
}

/**
 * Prisma-enum equivalent of lead-helpers' `isLostStage` (LOST, CANCELLED,
 * DISQUALIFIED). These are the stages that require a recorded reason.
 */
export function isClosedUnsuccessful(code: LeadStage): boolean {
  return PIPELINE_STAGES[code].outcome === "LOST";
}

/** Rolling window for the win-rate card. */
export const WIN_RATE_WINDOW_DAYS = 90;

/**
 * Instant from which wonAt/lostAt are recorded for real. Win-rate windows
 * reaching further back include values approximated by the one-off backfill
 * (scripts/backfill-lead-close-dates.ts) and are flagged in the UI.
 * 2026-08-16 00:00 Sydney (UTC+10).
 */
export const CLOSE_DATE_TRACKING_START = new Date("2026-08-15T14:00:00.000Z");

/**
 * Close-date changes implied by a stage transition.
 *
 * Returns a partial patch — an empty object means "change nothing". Pure, and
 * takes `now` explicitly so it is testable. Called from BOTH lead write paths
 * (lib/data/leads.ts updateLead and lib/data/offers.ts updateOfferStatus);
 * the offer path is how most real wins are recorded.
 */
export function closeDatePatch(
  previous: LeadStage | null,
  next: LeadStage,
  now: Date,
): { wonAt?: Date | null; lostAt?: Date | null } {
  if (previous === next) return {};

  const prevOutcome = previous ? PIPELINE_STAGES[previous].outcome : null;
  const nextOutcome = PIPELINE_STAGES[next].outcome;

  if (nextOutcome === "WON") {
    // WON -> CONVERTED is a move within the won outcome: keep the original date.
    if (prevOutcome === "WON") return {};
    return { wonAt: now, lostAt: null };
  }

  if (nextOutcome === "LOST") {
    if (prevOutcome === "LOST") return {};
    return { wonAt: null, lostAt: now };
  }

  // Moving to OPEN or STALLED. If it was closed, it is no longer a closed
  // deal and must leave the win-rate history.
  if (prevOutcome === "WON" || prevOutcome === "LOST") {
    return { wonAt: null, lostAt: null };
  }
  if (prevOutcome === null) return {};
  // OPEN <-> STALLED: nothing to stamp, but ensure stale stamps are cleared.
  return { wonAt: null, lostAt: null };
}
