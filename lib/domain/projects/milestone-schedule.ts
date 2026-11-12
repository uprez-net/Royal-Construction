import { addDays } from "date-fns";

import { MilestoneStatus } from "@prisma/client";

// The spacing of a project's activities from its start date.
//
// Its own module, with nothing but date arithmetic in it, so the Overview tab
// can preview the dates a start-date change will produce from the same rule the
// server then writes. Durations are snapshots on the project's milestones.

/** Calendar days between one activity's target date and the next. */
export const MILESTONE_SPACING_DAYS = 5;

/**
 * How long an activity takes when nothing says otherwise: two calendar days
 * after the one before it closed (issue #422). The build sequence stores a
 * duration on every row, so this is only reached by a caller that has none.
 */
export const DEFAULT_ACTIVITY_DURATION_DAYS = 2;

export interface MilestoneTiming {
  /** Planned start, retained as targetDate in the database. */
  targetDate: Date | string;
  startDate?: Date | string | null;
  estimatedDays?: number;
}

/** Completion target: actual start when recorded, otherwise planned start, plus calendar duration. */
export function milestoneEndDate(milestone: MilestoneTiming): Date {
  return addDays(
    new Date(milestone.startDate ?? milestone.targetDate),
    milestone.estimatedDays ?? DEFAULT_ACTIVITY_DURATION_DAYS,
  );
}

/**
 * When the activity at `position` is planned to start: the first (position 0) on the
 * project's start date, each one after it five calendar days later.
 *
 * `position` is the activity's place in `order`, not the `order` value itself —
 * activities added or removed leave gaps in `order`, and the schedule should
 * not grow holes with them. Sub-activities are in the sequence like any other
 * row, because each one is a separate piece of work on site.
 *
 * Compatibility helper for the original five-day schedule. New and rescheduled
 * projects use milestoneTargetDates with each activity's stored duration.
 */
export function milestoneTargetDate(startDate: Date, position: number): Date {
  return addDays(startDate, position * MILESTONE_SPACING_DAYS);
}

/** Sequential calendar targets: first on start, then each preceding activity's estimated days. */
export function milestoneTargetDates(
  startDate: Date,
  milestones: readonly { readonly estimatedDays?: number }[],
): Date[] {
  let elapsed = 0;
  return milestones.map((milestone) => {
    const target = addDays(startDate, elapsed);
    elapsed += milestone.estimatedDays ?? DEFAULT_ACTIVITY_DURATION_DAYS;
    return target;
  });
}

/** One row of a project's sequence, as the re-planner reads it. */
export interface SequencedActivity {
  readonly id: string;
  readonly status: MilestoneStatus;
  readonly targetDate: Date | string;
  readonly startDate?: Date | string | null;
  readonly actualDate?: Date | string | null;
  readonly estimatedDays?: number;
}

/**
 * Re-plan the activities after one whose dates just became a fact.
 *
 * Walks `ordered` (the project's activities in `order`) from `afterIndex + 1`,
 * carrying a cursor that starts at `from` -- the day the closed activity was
 * completed, or the new end of an activity whose duration changed:
 *
 * - **PENDING** is planned to start on the cursor, and so is due on the cursor
 *   plus its own duration; the cursor moves to that day.
 * - **ACTIVE** is already under way. Its planned start is left alone, and the
 *   cursor moves to its own estimated end.
 * - **DONE** keeps every date it has. The cursor moves to the day it was
 *   actually completed, so an activity finished out of sequence still anchors
 *   what follows it rather than being planned over.
 * - **NOT_REQUIRED** takes no time on site and is skipped.
 *
 * Only PENDING rows ever change, so a completed activity's history is never
 * rewritten. Returns just the rows whose planned start actually moves, which
 * is what makes re-running it a no-op rather than a drift.
 */
export function replanFollowingActivities(
  ordered: readonly SequencedActivity[],
  afterIndex: number,
  from: Date,
): { id: string; targetDate: Date }[] {
  const changes: { id: string; targetDate: Date }[] = [];
  let cursor = from;
  for (const activity of ordered.slice(afterIndex + 1)) {
    switch (activity.status) {
      case MilestoneStatus.PENDING: {
        if (new Date(activity.targetDate).getTime() !== cursor.getTime()) {
          changes.push({ id: activity.id, targetDate: cursor });
        }
        cursor = addDays(
          cursor,
          activity.estimatedDays ?? DEFAULT_ACTIVITY_DURATION_DAYS,
        );
        break;
      }
      case MilestoneStatus.ACTIVE:
        cursor = milestoneEndDate(activity);
        break;
      case MilestoneStatus.DONE:
        cursor = activity.actualDate
          ? new Date(activity.actualDate)
          : milestoneEndDate(activity);
        break;
      case MilestoneStatus.NOT_REQUIRED:
        break;
    }
  }
  return changes;
}

/**
 * Statuses that mean work on an activity has begun. A started activity never
 * returns to pending, so once any activity holds one, work has started on site
 * for good.
 */
export const STARTED_MILESTONE_STATUSES: MilestoneStatus[] = [
  MilestoneStatus.ACTIVE,
  MilestoneStatus.DONE,
];

/**
 * Whether work has started on site: any activity started or finished.
 *
 * From that moment the project's start date is a fact — the day the first
 * activity started, written there by `updateMilestone` — and no longer a plan
 * anybody may move.
 */
export function hasWorkStarted(
  milestones: readonly { readonly status: MilestoneStatus }[],
): boolean {
  return milestones.some((milestone) =>
    STARTED_MILESTONE_STATUSES.includes(milestone.status),
  );
}
