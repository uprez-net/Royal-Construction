import { formatSydneyDate, formatSydneyDateTime } from "@/lib/dates/sydney";

/**
 * A generated conversation title that does not repeat one the same person
 * already has.
 *
 * Two conversations both called "Weekly Task and Deadline Review" left the
 * office guessing which was which in the sidebar (#432). A repeat gets the
 * Sydney day it started ("· Fri 13 Nov 2026"), and a repeat on the same day
 * gets the time as well.
 */
export function distinctConversationTitle(
  title: string,
  existingTitles: readonly string[],
  startedAt: Date,
): string {
  const taken = new Set(
    existingTitles.map((existing) => existing.trim().toLowerCase()),
  );
  if (!taken.has(title.trim().toLowerCase())) return title;
  const withDay = `${title} · ${formatSydneyDate(startedAt)}`;
  if (!taken.has(withDay.toLowerCase())) return withDay;
  return `${title} · ${formatSydneyDateTime(startedAt)}`;
}
