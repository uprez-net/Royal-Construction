import { sydneyDateOnly } from "./sydney";

/**
 * How long a party has actually had, in the days they actually work.
 *
 * Every wait on the compliance file is quoted to us in working days: the NSW
 * Planning Portal says three to five for a 10.7 certificate, a surveyor or an
 * architect says ten to eleven for a set of plans. Counting calendar days
 * against those figures raises an alert on the Tuesday of a long weekend and
 * calls a firm late that is, by its own quote, two days early — and an alert
 * that is wrong that often stops being read, which costs more than the alerts
 * it was meant to raise.
 *
 * Sydney dates throughout, via `sydneyDateOnly`. The server runs on UTC, and a
 * document lodged at 9am Sydney on a Monday is lodged on Sunday as far as
 * `Date.getUTCDay()` is concerned.
 */

/** Sydney calendar date, as YYYY-MM-DD. Sorts and compares as a string. */
type CalendarDate = string;

function toCalendarDate(year: number, month: number, day: number): CalendarDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A calendar date read back as a UTC instant, purely to do arithmetic on it.
 *
 * Deliberately UTC and deliberately not `sydneyStartOfDay`. Nothing here is an
 * instant in anybody's day — it is a position on a calendar — and going through
 * a timezone to add one day is how "add 24 hours" lands on the same date twice
 * a year when daylight saving moves.
 */
function calendarToUtc(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function utcToCalendar(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = calendarToUtc(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return utcToCalendar(shifted);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date rather than an instant. */
function dayOfWeek(date: CalendarDate): number {
  return calendarToUtc(date).getUTCDay();
}

function isWeekend(date: CalendarDate): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

/**
 * Easter Sunday, by the anonymous Gregorian algorithm.
 *
 * Computed rather than tabulated because the alternative is a list somebody has
 * to remember to extend, and the year it runs out is the year every SLA on the
 * system quietly starts counting Good Friday as a working day.
 */
function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toCalendarDate(year, month, day);
}

/** The nth given weekday of a month — "the second Monday in June". */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): CalendarDate {
  let date = toCalendarDate(year, month, 1);
  while (dayOfWeek(date) !== weekday) {
    date = addCalendarDays(date, 1);
  }
  return addCalendarDays(date, (nth - 1) * 7);
}

/**
 * The Monday a weekend holiday is observed on, or the day itself.
 *
 * NSW substitutes New Year's Day, Australia Day, Christmas and Boxing Day when
 * they fall on a weekend; Anzac Day is not substituted. Only substitution
 * matters to this module — a holiday left on a Saturday removes no working day,
 * because Saturday was never one.
 */
function observed(date: CalendarDate): CalendarDate {
  const day = dayOfWeek(date);
  if (day === 6) return addCalendarDays(date, 2);
  if (day === 0) return addCalendarDays(date, 1);
  return date;
}

/**
 * NSW public holidays for one year.
 *
 * Statewide only. Local show days and the half-day regional variations are
 * deliberately absent: they move by council area, this module is asked the same
 * question about every job in the system, and being a day out on one of them is
 * a smaller error than pretending to a precision we do not have.
 */
function nswHolidays(year: number): Set<CalendarDate> {
  const easter = easterSunday(year);

  const dates = [
    observed(toCalendarDate(year, 1, 1)), // New Year's Day
    observed(toCalendarDate(year, 1, 26)), // Australia Day
    addCalendarDays(easter, -2), // Good Friday
    addCalendarDays(easter, -1), // Easter Saturday
    easter,
    addCalendarDays(easter, 1), // Easter Monday
    toCalendarDate(year, 4, 25), // Anzac Day — never substituted in NSW
    nthWeekdayOfMonth(year, 6, 1, 2), // King's Birthday
    nthWeekdayOfMonth(year, 10, 1, 1), // Labour Day
    observed(toCalendarDate(year, 12, 25)), // Christmas Day
    // Boxing Day. Substituted a day further when Christmas has already taken
    // the Monday, which is what happens when the 25th falls on a Sunday.
    observed(toCalendarDate(year, 12, 26)) ===
    observed(toCalendarDate(year, 12, 25))
      ? addCalendarDays(observed(toCalendarDate(year, 12, 26)), 1)
      : observed(toCalendarDate(year, 12, 26)),
  ];

  return new Set(dates);
}

/**
 * Memoised per year.
 *
 * The daily sweep asks this once per outreach across every live engagement, and
 * they are all inside a year or two of each other.
 */
const holidayCache = new Map<number, Set<CalendarDate>>();

function holidaysFor(year: number): Set<CalendarDate> {
  let holidays = holidayCache.get(year);
  if (!holidays) {
    holidays = nswHolidays(year);
    holidayCache.set(year, holidays);
  }
  return holidays;
}

/** Whether a Sydney calendar date is one anybody is at work on. */
export function isNswBusinessDay(date: CalendarDate): boolean {
  if (isWeekend(date)) return false;
  return !holidaysFor(Number(date.slice(0, 4))).has(date);
}

/**
 * NSW business days elapsed between two instants.
 *
 * Counts the working days strictly after `from`'s Sydney date up to and
 * including `to`'s. So a request lodged on a Monday reads as 0 that day, 1 on
 * the Tuesday, and 5 on the following Monday — which is how "the portal takes
 * three to five days" is meant when somebody says it.
 *
 * Zero when `to` is on or before `from`. A clock cannot run backwards, and a
 * negative here would read as "not due yet" at exactly the wrong moment: a
 * lodgement date typed in as next month must not silence the alert for a month.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  const start = sydneyDateOnly(from);
  const end = sydneyDateOnly(to);
  if (end <= start) return 0;

  let elapsed = 0;
  let cursor = addCalendarDays(start, 1);
  // Bounded so a bad stored date cannot spin: a decade of days is far past any
  // threshold this is compared against, and the answer is "very overdue" either
  // way.
  let guard = 0;
  while (cursor <= end && guard < 4000) {
    if (isNswBusinessDay(cursor)) elapsed += 1;
    cursor = addCalendarDays(cursor, 1);
    guard += 1;
  }
  return elapsed;
}

/** NSW business days between `from` and now. */
export function businessDaysSince(from: Date, now: Date = new Date()): number {
  return businessDaysBetween(from, now);
}
