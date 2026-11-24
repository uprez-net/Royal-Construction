import { sydneyDateOnly, sydneyEndOfDay } from "@/lib/dates/sydney";

// When an Eve approval stops being answerable (#617). Pure and free of
// Prisma, so the approval card in the browser shows the same deadline the
// expiry cron and the late-approval refusal enforce.

const WEEKEND = new Set([0, 6]);

/** `YYYY-MM-DD` plus `days`, as a calendar date (no time zone involved). */
function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/**
 * When an approval stops being answerable: the end of the next Sydney working
 * day after it was asked for. Asked on a Friday afternoon, it lasts until the
 * end of Monday; asked on Monday, until the end of Tuesday. Long enough for
 * someone who was out to come back to it, short enough that the record it
 * changes is still the one the person reviewed. Public holidays are not
 * counted out: a holiday only makes an approval expire a day sooner, which is
 * the safe direction.
 */
export function approvalExpiresAt(requestedAt: Date): Date {
  let day = addCalendarDays(sydneyDateOnly(requestedAt), 1);
  while (WEEKEND.has(weekdayOf(day))) day = addCalendarDays(day, 1);
  return sydneyEndOfDay(day);
}

export function isApprovalExpired(requestedAt: Date, now: Date): boolean {
  return now.getTime() > approvalExpiresAt(requestedAt).getTime();
}
