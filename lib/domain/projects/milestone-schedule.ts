import { addDays } from "date-fns";

// The spacing of a project's activities from its start date.
//
// Its own module, with nothing but date arithmetic in it, so the Overview tab
// can preview the dates a start-date change will produce from the same rule the
// server then writes — rather than a second copy of "five days apart" in a
// component.

/** Calendar days between one activity's target date and the next. */
export const MILESTONE_SPACING_DAYS = 5;

/**
 * When the activity at `position` falls due: the first (position 0) on the
 * project's start date, each one after it five calendar days later.
 *
 * `position` is the activity's place in `order`, not the `order` value itself —
 * activities added or removed leave gaps in `order`, and the schedule should
 * not grow holes with them. Sub-activities are in the sequence like any other
 * row, because each one is a separate piece of work on site.
 *
 * The one spacing rule: seeding a new project and moving an existing project's
 * start date both use it, so a project re-dated to the start it already had
 * reads exactly as it did the day it was created.
 */
export function milestoneTargetDate(startDate: Date, position: number): Date {
  return addDays(startDate, position * MILESTONE_SPACING_DAYS);
}
