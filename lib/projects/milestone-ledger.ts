import { differenceInCalendarDays } from "date-fns";

import {
  milestoneEndDate,
  type MilestoneTiming,
} from "@/lib/domain/projects/milestone-schedule";
import { MilestoneStatus } from "@prisma/client";

/**
 * Derivations behind the Milestones tab's claim ledger.
 *
 * The tab renders one row per contract stage, so every number it shows is a
 * roll-up of that stage's activities. Keeping the arithmetic here — rather than
 * inline in the component — is what lets the money-adjacent parts (how many
 * activities a stage still owes, which one is next, whether it is late) be
 * tested without a database.
 *
 * Everything is structural: any object carrying these fields works, so the
 * component passes `UIMilestone` straight through and the tests pass literals.
 */
export interface LedgerMilestone extends MilestoneTiming {
  name: string;
  status: MilestoneStatus;
  targetDate: Date;
  actualDate: Date | null;
  childrenMilestones: LedgerMilestone[];
}

/** Active first, then the work queued behind it, then what is already behind us. */
const STATUS_RANK: Record<MilestoneStatus, number> = {
  [MilestoneStatus.ACTIVE]: 0,
  [MilestoneStatus.PENDING]: 1,
  [MilestoneStatus.DONE]: 2,
  [MilestoneStatus.NOT_REQUIRED]: 3,
};

export type StageState = "complete" | "active" | "upcoming";

export interface StageRollup {
  /** Activities finished, excluding the ones that were waived. */
  done: number;
  /** Activities that count as work, i.e. everything except the waived ones. */
  total: number;
  /** Waived activities. Reported separately so they never inflate progress. */
  notRequired: number;
  /** Activities still owed — the number the stage is waiting on. */
  remaining: number;
}

/** A finished activity: done, or waived so it will never be done. */
export function isSettled(milestone: Pick<LedgerMilestone, "status">): boolean {
  return (
    milestone.status === MilestoneStatus.DONE
    || milestone.status === MilestoneStatus.NOT_REQUIRED
  );
}

/** The activity and every descendant, depth-first. */
export function flattenMilestones<T extends LedgerMilestone>(
  milestones: T[],
): T[] {
  return milestones.flatMap((milestone) => [
    milestone,
    ...flattenMilestones(milestone.childrenMilestones as T[]),
  ]);
}

/**
 * Progress for one stage, counted over its top-level activities only —
 * the same rows the tab lists, so the header and the "N done" fold can never
 * disagree. Waived activities are excluded from both sides of the ratio: they
 * were never work, so counting them as done would inflate the stage's progress.
 */
export function stageRollup(milestones: LedgerMilestone[]): StageRollup {
  const notRequired = milestones.filter(
    (milestone) => milestone.status === MilestoneStatus.NOT_REQUIRED,
  ).length;
  const done = milestones.filter(
    (milestone) => milestone.status === MilestoneStatus.DONE,
  ).length;

  return {
    done,
    total: milestones.length - notRequired,
    notRequired,
    remaining: milestones.filter((milestone) => !isSettled(milestone)).length,
  };
}

/**
 * Where a stage stands. Unlike the roll-up this reads the whole tree: a stage
 * with an unfinished sub-activity is not complete, however its parents look.
 */
export function stageState(milestones: LedgerMilestone[]): StageState {
  const everyActivity = flattenMilestones(milestones);

  if (everyActivity.length === 0) {
    return "upcoming";
  }

  if (everyActivity.every(isSettled)) {
    return "complete";
  }

  const hasStarted =
    everyActivity.some(
      (milestone) => milestone.status === MilestoneStatus.ACTIVE,
    ) || everyActivity.some(isSettled);

  return hasStarted ? "active" : "upcoming";
}

/** Active first, then pending, then settled; ties broken by target date. */
export function sortActivities<T extends LedgerMilestone>(
  milestones: T[],
): T[] {
  return [...milestones].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status]
      || a.targetDate.getTime() - b.targetDate.getTime(),
  );
}

/**
 * Splits a stage into the work still to do and the work behind it. The tab
 * lists `open` and folds `settled` away, so the thing needing attention is
 * never below the thing that is finished.
 */
export function partitionActivities<T extends LedgerMilestone>(
  milestones: T[],
): { open: T[]; settled: T[] } {
  return {
    open: sortActivities(
      milestones.filter((milestone) => !isSettled(milestone)),
    ),
    settled: [...milestones.filter(isSettled)].sort(
      (a, b) => (b.actualDate?.getTime() ?? 0) - (a.actualDate?.getTime() ?? 0),
    ),
  };
}

export interface NextActivity<T> {
  activity: T;
  /** Set when the next activity is a sub-activity, so the row can be named in full. */
  parent: T | null;
}

/**
 * The single activity a builder should look at next.
 *
 * Leaf-first: a parent with children cannot itself be finished — its children
 * are what actually move, so naming the parent would point at a row with no
 * action on it. Falls back to the earliest-due pending activity.
 */
export function nextActivity<T extends LedgerMilestone>(
  milestones: T[],
): NextActivity<T> | null {
  const parentOf = new Map<T, T | null>();

  const walk = (list: T[], parent: T | null) => {
    for (const milestone of list) {
      parentOf.set(milestone, parent);
      walk(milestone.childrenMilestones as T[], milestone);
    }
  };
  walk(milestones, null);

  // Active before pending, then soonest due.
  const byUrgency = (a: T, b: T) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || a.targetDate.getTime() - b.targetDate.getTime();

  const outstanding = [...parentOf.keys()].filter(
    (milestone) => !isSettled(milestone),
  );

  // Leaves only: a parent carries no Finish of its own, so naming one points
  // the builder at a row they cannot act on. An active parent whose children
  // are all done is the exception — it is outstanding with no leaf beneath it,
  // and is then the row to name.
  const leaves = outstanding.filter(
    (milestone) => milestone.childrenMilestones.length === 0,
  );

  const pick =
    [...leaves].sort(byUrgency)[0] ?? [...outstanding].sort(byUrgency)[0];

  return pick ? { activity: pick, parent: parentOf.get(pick) ?? null } : null;
}

export type DuenessKind = "overdue" | "today" | "soon" | "scheduled";

export interface Dueness {
  kind: DuenessKind;
  /** Whole days until the estimated end date; negative once it has passed. */
  days: number;
}

/** Anything landing inside this window reads as imminent rather than merely booked. */
const SOON_WINDOW_DAYS = 7;

/**
 * How an activity's estimated end should read. Calendar days, not elapsed hours, so an
 * activity due tomorrow says "in 1d" no matter what time either date carries.
 */
export function duenessOf(milestone: MilestoneTiming, today: Date): Dueness {
  const days = differenceInCalendarDays(milestoneEndDate(milestone), today);

  if (days < 0) return { kind: "overdue", days };
  if (days === 0) return { kind: "today", days };
  if (days <= SOON_WINDOW_DAYS) return { kind: "soon", days };
  return { kind: "scheduled", days };
}

/**
 * Calendar days an open activity has gone past its estimated completion, or
 * null when it is not overdue.
 *
 * Open means PENDING or ACTIVE (issue #422): an activity that was due to be
 * finished and has not even started is the most overdue kind there is, and
 * hiding the badge until somebody pressed Start hid exactly that one. A
 * completed or waived activity is never overdue -- its history says whether
 * it finished late. Due today is not overdue; the day after is.
 */
export function openOverdueDays(
  milestone: MilestoneTiming & { status: MilestoneStatus },
  now: Date,
): number | null {
  if (
    milestone.status !== MilestoneStatus.ACTIVE
    && milestone.status !== MilestoneStatus.PENDING
  ) {
    return null;
  }

  const due = duenessOf(milestone, now);
  return due.kind === "overdue" ? -due.days : null;
}

/**
 * Days an activity ran past its estimated end, or 0 when it finished on time or early.
 *
 * Early completion is deliberately not reported: on this tab the dates are
 * often set per stage rather than per activity, so "24d early" reads as a data
 * error and undermines trust in the dates that do matter. Late is the fact that
 * carries consequences for a claim.
 */
export function daysLate(milestone: MilestoneTiming, actualDate: Date): number {
  return Math.max(
    0,
    differenceInCalendarDays(actualDate, milestoneEndDate(milestone)),
  );
}

/** The most recently finished activity, for the "last …" note on the fold. */
export function lastCompleted<T extends LedgerMilestone>(
  milestones: T[],
): T | null {
  return (
    milestones
      .filter(
        (milestone) =>
          milestone.status === MilestoneStatus.DONE && milestone.actualDate,
      )
      .sort(
        (a, b) =>
          (b.actualDate as Date).getTime() - (a.actualDate as Date).getTime(),
      )[0] ?? null
  );
}

/**
 * What one stage claims, in dollars.
 *
 * The contract's own schedule wins: the amount there is what the owner agreed
 * to pay for that stage, and the sum it was derived from can differ from the
 * project budget. Only when the schedule states no amount is one computed from
 * the stage percentage.
 */
export function stageClaimAmount(
  contractAmount: number | null | undefined,
  percentage: number | null,
  projectBudget: number,
): number | null {
  if (contractAmount != null) {
    return contractAmount;
  }

  if (!Number.isFinite(projectBudget) || percentage === null) {
    return null;
  }

  return (percentage / 100) * projectBudget;
}

/**
 * The stage currently being worked: the first one not yet complete.
 *
 * Stages are claimed in contract order, so only this stage accepts work — every
 * later stage is gated behind it. Returns -1 once the whole schedule is done.
 */
export function findWorkingStageIndex(states: StageState[]): number {
  return states.findIndex((state) => state !== "complete");
}
