import type { ProjectAttention } from "./attention";

// Pure, and apart from the attention read, so the Projects list's Overdue
// panel (a client component) can ask the same question the filter asks.

type OverdueParts = Pick<ProjectAttention, "overdue" | "overdueBookings">;

/**
 * Overdue: an activity running past its estimated end, or a trade booking an
 * activity needed confirmed by now. The Projects list's Overdue chip, its
 * count and the Alerts panel above the list all mean this.
 */
export function isProjectOverdue(project: OverdueParts): boolean {
  return project.overdue.length > 0 || project.overdueBookings.length > 0;
}

/** Most days past anything owed: an activity's end or a booking's start. */
export function overdueLateness(project: OverdueParts): number {
  return Math.max(
    project.overdue[0]?.daysOverdue ?? 0,
    project.overdueBookings[0]?.daysLate ?? 0,
  );
}
