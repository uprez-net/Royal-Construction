import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  formatIsoForPeople,
  formatSydneyDate,
  formatSydneyDateTime,
  nextSydneyOffsetChange,
  sydneyToday,
  sydneyUtcOffset,
  sydneyWallClockToInstant,
} from "@/lib/dates/sydney";

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + days))
    .toISOString()
    .slice(0, 10);
}

function readable(day: string): string {
  return formatIsoForPeople(day) ?? day;
}

/**
 * "This week" and "next week" as the office means them, in Sydney dates.
 *
 * Asked on Friday 13 Nov whether a tradie was booked "next week", the agent
 * checked Sat 14 – Fri 20 Nov: the next seven days. The office means Monday 16
 * to Sunday 22 (#429). Stating the ranges beats a rule the model has to apply.
 */
export function sydneyWeekRanges(now: Date = new Date()) {
  const today = sydneyToday(now);
  const [year, month, date] = today.split("-").map(Number);
  // 0 = Monday … 6 = Sunday.
  const weekday =
    (new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  return {
    thisWeek: { start: monday, end: addDays(monday, 6) },
    nextWeek: { start: addDays(monday, 7), end: addDays(monday, 13) },
  };
}

/**
 * What the model needs to get dates right, for the moment it is asked.
 *
 * Without it the model has no idea what day it is: "tomorrow at 9am" became a
 * task due on the 19th when it was the 23rd. It also wrote the ISO strings the
 * tools return straight back to the office. Tool date-times carry an offset,
 * so the model also needs Sydney's offset — and the next change, because a
 * booking made in September for a date in October crosses into AEDT.
 */
export function currentSydneyTimeInstructions(now: Date = new Date()): string {
  const offset = sydneyUtcOffset(now);
  const change = nextSydneyOffsetChange(now);
  const todayMorningOffset = sydneyUtcOffset(
    sydneyWallClockToInstant(sydneyToday(now), "09:00"),
  );
  const weeks = sydneyWeekRanges(now);
  const lines = [
    "## Current date and time",
    `It is ${formatSydneyDateTime(now)} in Sydney (Australia/Sydney, UTC${offset}). Today's Sydney date is ${sydneyToday(now)}.`,
  ];
  if (change) {
    lines.push(
      `Sydney changes to UTC${sydneyUtcOffset(change)} (${formatSydneyDateTime(change).split(" ").at(-1)}) on ${formatSydneyDate(change)}; a date-time on or after that uses the new offset.`,
    );
  }
  lines.push(
    "- Resolve relative dates such as today, tomorrow or next Friday against the Sydney date above, never UTC. Business hours and due times are Sydney wall-clock times.",
    `- Weeks run Monday to Sunday. "This week" is ${readable(weeks.thisWeek.start)} to ${readable(weeks.thisWeek.end)}; "next week" is ${readable(weeks.nextWeek.start)} to ${readable(weeks.nextWeek.end)} — not the next seven days. "Next week's working days" are Monday to Friday of that week.`,
    "- When you hand work to a specialist, write every date as an explicit calendar date (for example 25 Sept 2026, 9:00 am) rather than a relative word.",
    "- Sydney daylight saving starts at 2:00 am, when clocks move forward to 3:00 am, and ends at 2:00 am AEDT, when clocks move back to 1:00 am AEST. Determine the offset for each requested wall-clock time by converting that exact Sydney date and time with sydneyWallClockToInstant and checking the resulting instant with sydneyUtcOffset; never infer it from today's time or from the date alone.",
    `- For example, on Sun 4 Oct 2026, 1:00 am is still AEST (UTC+10:00), while a 9:00 am booking is AEDT (UTC+11:00). For a tool date-time, send ISO 8601 with the offset determined for that exact wall-clock time, such as ${sydneyToday(now)}T09:00:00${todayMorningOffset} for today's 9:00 am.`,
    '- When writing for people, write dates as "Fri 25 Sept 2026" and times as "9:00 am AEST" (AEDT during daylight saving). Never show ISO strings, UTC or Z timestamps to people.',
  );
  return lines.join("\n");
}

/** Re-resolved every turn, so a session left open overnight is not a day out. */
export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({ content: currentSydneyTimeInstructions() }),
  },
});
