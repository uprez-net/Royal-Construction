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
 * "AEST" or "AEDT", whichever Sydney is actually on at that instant.
 *
 * The label was hardcoded to AEST everywhere a consultation time is shown —
 * the slot picker, the booking summary and the confirmation email — so for the
 * half of the year Sydney spends on daylight saving, roughly October to April,
 * the client booked "4:00 pm (AEST)" and the calendar invitation beside it read
 * 4pm AEDT. The time was always right; only the abbreviation disagreed.
 *
 * `en-AU` is what produces the abbreviation — `en-US` and `en-GB` both return
 * "GMT+11". A runtime with trimmed ICU data returns the offset form instead, so
 * the offset is the fallback rather than printing "GMT+11" to a client.
 */
export function sydneyTimeZoneAbbreviation(date: Date): "AEST" | "AEDT" {
  const named = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  if (named === "AEST" || named === "AEDT") return named;

  // Sydney is UTC+11 on daylight saving and UTC+10 the rest of the year.
  const local = toZonedTime(date, SYDNEY_TZ);
  const offsetHours = (local.getTime() - date.getTime()) / 3_600_000;
  return Math.round(offsetHours) === 11 ? "AEDT" : "AEST";
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
 * The instant a Sydney wall clock describes.
 *
 * The inverse of `sydneyDateOnly` + `sydneyTimeOnly`, and the pair a history
 * entry travels as. `new Date(`${day}T${time}`)` is the third variation this
 * module's header warns about: it reads the pair in the server's zone, which is
 * UTC on Vercel, so every entry landed ten hours late and a round trip through
 * the client pushed it ten hours later again.
 */
export function sydneyWallClockToInstant(day: string, time?: string): Date {
  const normalisedTime = /^\d{2}:\d{2}$/.test(time ?? "") ? time : "00:00";
  return fromZonedTime(`${day}T${normalisedTime}:00`, SYDNEY_TZ);
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
