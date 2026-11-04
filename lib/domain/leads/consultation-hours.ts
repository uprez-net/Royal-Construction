import { DomainValidationError } from "../errors";

// When a consultation can be booked, and for how long.
//
// The opening hours used to live only in the booking page, which generated the
// slots it offered; the route behind it, on the open internet, took any start
// time it was sent and always booked one hour. A length the visitor chooses
// makes that gap matter — a request is just JSON, and "nine hours from 5pm"
// is as easy to post as "one hour at 2pm" — so the page and the route now read
// the same rule, and the route refuses what the page would never offer.
//
// Pure, on Sydney wall-clock values: the page builds them from the calendar,
// the route reads them off the request, and neither has to agree on a
// timezone to agree on the answer.

/** The lengths a client can book, in minutes. */
export const CONSULTATION_DURATIONS_MINUTES = [60, 90, 120, 180] as const;

export type ConsultationDurationMinutes =
  (typeof CONSULTATION_DURATIONS_MINUTES)[number];

/**
 * What a request with no length books: an hour, which is what every booking
 * was before the length could be chosen — so a page loaded before this change
 * still books what it says.
 */
export const DEFAULT_CONSULTATION_MINUTES: ConsultationDurationMinutes = 60;

export function isConsultationDuration(
  value: unknown,
): value is ConsultationDurationMinutes {
  return (CONSULTATION_DURATIONS_MINUTES as readonly unknown[]).includes(value);
}

/** "1 hour", "1.5 hours", "2 hours". */
export function consultationDurationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Opening hours on a day of the week (0 = Sunday), as whole Sydney hours:
 * consultations start no earlier than `open` and end by `close`.
 */
export function consultationHours(dayOfWeek: number): {
  readonly open: number;
  readonly close: number;
} {
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;
  return weekend ? { open: 9, close: 14 } : { open: 14, close: 18 };
}

/**
 * The start times ("HH:00") on a day of the week that leave room for a
 * consultation of `minutes` to finish by closing time. A two-hour meeting on a
 * weekday cannot start at 5pm and run past six.
 */
export function consultationStartTimes(
  dayOfWeek: number,
  minutes: number,
): string[] {
  const { open, close } = consultationHours(dayOfWeek);
  const starts: string[] = [];
  for (let hour = open; hour * 60 + minutes <= close * 60; hour++) {
    starts.push(`${hour.toString().padStart(2, "0")}:00`);
  }
  return starts;
}

/** 14 -> "2pm". */
function clockHour(hour: number): string {
  return `${hour % 12 || 12}${hour >= 12 ? "pm" : "am"}`;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Refuse a requested start and length the page would never have offered.
 *
 * @param startWallClock Sydney wall clock, "YYYY-MM-DDTHH:mm[:ss]" — exactly
 * the string the page sends.
 */
export function assertConsultationSlot(
  startWallClock: string,
  minutes: number,
): void {
  if (!isConsultationDuration(minutes)) {
    throw new DomainValidationError(
      `A consultation can be ${CONSULTATION_DURATIONS_MINUTES.map(consultationDurationLabel).join(", ")} long.`,
      "durationMinutes",
    );
  }

  const match = WALL_CLOCK.exec(startWallClock);
  if (!match) {
    throw new DomainValidationError(
      "The requested appointment time is invalid.",
      "startDateTime",
    );
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) {
    throw new DomainValidationError(
      "The requested appointment time is invalid.",
      "startDateTime",
    );
  }

  // The day of the week belongs to the calendar date, not to an instant, so
  // reading it in UTC from the bare date is the Sydney answer too.
  const time = `${hour}:${minute}`;
  if (
    (second !== undefined && second !== "00")
    || !consultationStartTimes(date.getUTCDay(), minutes).includes(time)
  ) {
    const { open, close } = consultationHours(date.getUTCDay());
    throw new DomainValidationError(
      `That time is outside consultation hours. A ${consultationDurationLabel(minutes)} consultation that day has to start on the hour, no earlier than ${clockHour(open)}, and finish by ${clockHour(close)}.`,
      "startDateTime",
    );
  }
}
