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
  return fromZonedTime(`${day}T${normaliseWallClockTime(time)}:00`, SYDNEY_TZ);
}

/**
 * `HH:mm` within a real clock, or midnight.
 *
 * Shape alone is not enough. `Lead.followupTime` is free text, so "24:99" and
 * "99:99" both match /^\d{2}:\d{2}$/ and both make date-fns-tz return an
 * Invalid Date — which Prisma then rejects, failing the entire lead mutation
 * over a malformed reminder time. Midnight is the same answer a missing time
 * gets, and it keeps the save.
 */
function normaliseWallClockTime(time?: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!match) return "00:00";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "00:00";

  return `${match[1]}:${match[2]}`;
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

/*
 * People-facing dates.
 *
 * The operations agent passes dates through as ISO strings — tool outputs,
 * envelope fields, approval inputs, and the model copying them into prose —
 * so the office read "2026-09-24T23:00:00.000Z" for a 9am Friday task. These
 * render an instant as a Sydney date and time in Australian form:
 * "Fri 25 Sept 2026" and "Fri 25 Sept 2026, 9:00 am AEST".
 */

function peopleParts(date: Date, withTime: boolean): Record<string, string> {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
}

/** "Fri 25 Sept 2026": the Sydney calendar date of an instant. */
export function formatSydneyDate(date: Date): string {
  const p = peopleParts(date, false);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Fri 25 Sept 2026, 9:00 am AEST": an instant on the Sydney wall clock. */
export function formatSydneyDateTime(date: Date): string {
  const p = peopleParts(date, true);
  const period = (p.dayPeriod ?? "").toLowerCase();
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}${period ? ` ${period}` : ""} ${sydneyTimeZoneAbbreviation(date)}`;
}

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

export function isValidIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= daysInMonth[month - 1];
}

/**
 * An ISO date or timestamp, as a person should read it; `null` for anything
 * else.
 *
 * A bare `YYYY-MM-DD` is a calendar date, not an instant, so it is shown as
 * written rather than shifted through a time zone. A timestamp that lands on
 * Sydney midnight is how day-level dates (due dates, close dates) are stored,
 * so it reads as the day rather than "12:00 am".
 */
export function formatIsoForPeople(value: string): string | null {
  const text = value.trim();
  const dateOnly = ISO_DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 12),
    );
    if (Number.isNaN(date.getTime()) || sydneyDateOnly(date) !== text)
      return null;
    return formatSydneyDate(date);
  }
  if (!ISO_DATE_TIME.test(text)) return null;
  if (!isValidIsoCalendarDate(text.slice(0, 10))) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return sydneyTimeOnly(date) === "00:00"
    ? formatSydneyDate(date)
    : formatSydneyDateTime(date);
}

/**
 * Every ISO date or timestamp inside free text, rewritten for people.
 *
 * Bounded so a date inside an identifier or file name ("quote-2026-09-25.pdf")
 * is left alone.
 */
export function humanizeIsoDatesInText(text: string): string {
  const protectedRanges: Array<{ start: number; end: number }> = [];
  for (const url of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
    const start = url.index ?? 0;
    protectedRanges.push({ start, end: start + url[0].length });
  }

  // A regex that stops at the first `)` truncates destinations containing
  // parenthesised path segments, leaving any later dates exposed as prose.
  for (const link of text.matchAll(/\]\(/g)) {
    const start = link.index ?? 0;
    let depth = 0;
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === "\n") break;
      if (text[index] === "(") depth++;
      else if (text[index] === ")" && --depth === 0) {
        protectedRanges.push({ start, end: index + 1 });
        break;
      }
    }
  }
  protectedRanges.sort((a, b) => a.start - b.start);
  const humanize = (prose: string) =>
    prose.replace(
      /(?<![\w-])\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w-])/g,
      (match) => {
        // A timestamp with no zone is ambiguous; leave it rather than guess.
        if (match.includes("T") && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(match)) {
          return match;
        }
        return formatIsoForPeople(match) ?? match;
      },
    );

  let result = "";
  let start = 0;
  for (const protectedRange of protectedRanges) {
    const index = protectedRange.start;
    if (index < start) continue;
    result += humanize(text.slice(start, index));
    result += text.slice(index, protectedRange.end);
    start = protectedRange.end;
  }
  return result + humanize(text.slice(start));
}

/** "+10:00" or "+11:00": Sydney's offset from UTC at that instant. */
export function sydneyUtcOffset(date: Date): string {
  // From the Sydney wall-clock parts, not `toZonedTime`: that returns a Date
  // expressed in the machine's own zone, so its difference from `date` is
  // Sydney's offset only on a machine running in UTC.
  const p = parts(date);
  const wallClockAsUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
  );
  const minutes = Math.round(
    (wallClockAsUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000,
  );
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * The next instant Sydney changes between AEST and AEDT, within a year.
 *
 * A model that knows only today's offset writes a date next month with the
 * wrong one, an hour out, for every booking across the October or April
 * change.
 */
export function nextSydneyOffsetChange(from: Date = new Date()): Date | null {
  const start = sydneyUtcOffset(from);
  const hour = 3_600_000;
  let low = from.getTime();
  for (let t = low + 24 * hour; t <= low + 366 * 24 * hour; t += 24 * hour) {
    if (sydneyUtcOffset(new Date(t)) !== start) {
      let high = t;
      low = t - 24 * hour;
      // Offsets change on a minute boundary, so search whole minutes.
      low = Math.floor(low / 60_000);
      high = Math.ceil(high / 60_000);
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (sydneyUtcOffset(new Date(mid * 60_000)) === start) low = mid;
        else high = mid;
      }
      return new Date(high * 60_000);
    }
    low = t;
  }
  return null;
}
