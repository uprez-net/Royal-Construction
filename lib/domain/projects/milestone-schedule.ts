import { addDays } from "date-fns";

import { MilestoneStatus } from "@prisma/client";

// The spacing of a project's activities from its start date.
//
// Its own module, with nothing but date arithmetic in it, so the Overview tab
// can preview the dates a start-date change will produce from the same rule the
// server then writes. Durations are snapshots on the project's milestones.

/** Calendar days between one activity's target date and the next. */
export const MILESTONE_SPACING_DAYS = 5;

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
    milestone.estimatedDays ?? MILESTONE_SPACING_DAYS,
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
    elapsed += milestone.estimatedDays ?? MILESTONE_SPACING_DAYS;
    return target;
  });
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
