import { differenceInCalendarDays } from "date-fns";

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
 * Everything is structural: any object carrying these four fields works, so the
 * component passes `UIMilestone` straight through and the tests pass literals.
 */
export interface LedgerMilestone {
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
    milestone.status === MilestoneStatus.DONE ||
    milestone.status === MilestoneStatus.NOT_REQUIRED
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
export function sortActivities<T extends LedgerMilestone>(milestones: T[]): T[] {
  return [...milestones].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.targetDate.getTime() - b.targetDate.getTime(),
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
    open: sortActivities(milestones.filter((milestone) => !isSettled(milestone))),
    settled: [...milestones.filter(isSettled)].sort(
      (a, b) =>
        (b.actualDate?.getTime() ?? 0) - (a.actualDate?.getTime() ?? 0),
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

  const candidates = [...parentOf.keys()];
  const byTargetDate = (a: T, b: T) =>
    a.targetDate.getTime() - b.targetDate.getTime();

  const activeLeaf = candidates
    .filter(
      (milestone) =>
        milestone.status === MilestoneStatus.ACTIVE &&
        milestone.childrenMilestones.length === 0,
    )
    .sort(byTargetDate)[0];

  const pick =
    activeLeaf ??
    candidates
      .filter((milestone) => milestone.status === MilestoneStatus.ACTIVE)
      .sort(byTargetDate)[0] ??
    candidates
      .filter((milestone) => milestone.status === MilestoneStatus.PENDING)
      .sort(byTargetDate)[0];

  return pick ? { activity: pick, parent: parentOf.get(pick) ?? null } : null;
}

export type DuenessKind = "overdue" | "today" | "soon" | "scheduled";

export interface Dueness {
  kind: DuenessKind;
  /** Whole days until the target date; negative once it has passed. */
  days: number;
}

/** Anything landing inside this window reads as imminent rather than merely booked. */
const SOON_WINDOW_DAYS = 7;

/**
 * How a target date should read. Calendar days, not elapsed hours, so an
 * activity due tomorrow says "in 1d" no matter what time either date carries.
 */
export function duenessOf(targetDate: Date, today: Date): Dueness {
  const days = differenceInCalendarDays(targetDate, today);

  if (days < 0) return { kind: "overdue", days };
  if (days === 0) return { kind: "today", days };
  if (days <= SOON_WINDOW_DAYS) return { kind: "soon", days };
  return { kind: "scheduled", days };
}

/**
 * Days an activity ran past its target, or 0 when it landed on time or early.
 *
 * Early completion is deliberately not reported: on this tab the dates are
 * often set per stage rather than per activity, so "24d early" reads as a data
 * error and undermines trust in the dates that do matter. Late is the fact that
 * carries consequences for a claim.
 */
export function daysLate(targetDate: Date, actualDate: Date): number {
  return Math.max(0, differenceInCalendarDays(actualDate, targetDate));
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
 * The stage currently being worked: the first one not yet complete.
 *
 * Stages are claimed in contract order, so only this stage accepts work — every
 * later stage is gated behind it. Returns -1 once the whole schedule is done.
 */
export function findWorkingStageIndex(states: StageState[]): number {
  return states.findIndex((state) => state !== "complete");
}
