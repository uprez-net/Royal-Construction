import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Every date this business cares about is a Sydney date.
 *
 * Before this module, each caller reinvented that and got it wrong in a
 * different way. All three of these shipped:
 *
 *   toISOString().slice(0, 10)      a UTC calendar date, one day off after 10am
 *   toTimeString().slice(0, 5)      the server's clock, which is UTC on Vercel
 *   new Date(`${sydneyDate}T00:00:00.000Z`)
 *                                   a Sydney date parsed as UTC, 10 or 11 hours out
 *
 * The last two stopped reminder emails firing at all. Route date handling
 * through here rather than adding a fourth variation.
 */
export const SYDNEY_TZ = "Australia/Sydney";

function parts(date: Date): Record<string, string> {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
}

/** The Sydney calendar date, as YYYY-MM-DD. Sorts and compares as a string. */
export function sydneyDateOnly(date: Date): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The Sydney wall-clock time, as HH:mm on a 24-hour clock. */
export function sydneyTimeOnly(date: Date): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

/** Today in Sydney, as YYYY-MM-DD. */
export function sydneyToday(now: Date = new Date()): string {
  return sydneyDateOnly(now);
}

/**
 * The instant a Sydney calendar day begins.
 *
 * Not `new Date(`${day}T00:00:00.000Z`)`. That parses the Sydney date as UTC
 * and lands ten hours late in AEST, eleven in AEDT, which is a third of the
 * year wrong by a different amount.
 */
export function sydneyStartOfDay(day: string): Date {
  return fromZonedTime(`${day}T00:00:00`, SYDNEY_TZ);
}

/** The last instant of a Sydney calendar day. */
export function sydneyEndOfDay(day: string): Date {
  return fromZonedTime(`${day}T23:59:59.999`, SYDNEY_TZ);
}

/**
 * `days` from `from`, landing on Sydney midnight.
 *
 * Normalised so a task created at 4pm is not overdue the next morning against
 * a bucket boundary that compares whole days.
 */
export function sydneyMidnightIn(days: number, from: Date = new Date()): Date {
  const local = toZonedTime(from, SYDNEY_TZ);
  local.setDate(local.getDate() + days);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, SYDNEY_TZ);
}
