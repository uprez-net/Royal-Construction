import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  formatSydneyDate,
  formatSydneyDateTime,
  nextSydneyOffsetChange,
  sydneyToday,
  sydneyUtcOffset,
} from "@/lib/dates/sydney";

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
    "- When you hand work to a specialist, write every date as an explicit calendar date (for example 25 Sept 2026, 9:00 am) rather than a relative word.",
    `- When a tool takes a date-time, send ISO 8601 with the Sydney offset in force on that date, for example ${sydneyToday(now)}T09:00:00${offset}.`,
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
