import type { TradieBooking } from "@/lib/domain/tradies/schedules";

// Day arithmetic for the schedule modal, on `YYYY-MM-DD` strings so a browser
// timezone can never shift a booking by a day. Mirrors the half-open rule in
// `assertNoScheduleConflict`: a booking holds `durationDays` working days from
// its first one, and the server is still what refuses an overlap.

export type { TradieBooking };

/** `YYYY-MM-DD` plus `days`, in UTC. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The bookings that hold the tradie on this day. */
export function bookingsOn(
  bookings: readonly TradieBooking[],
  day: string,
): TradieBooking[] {
  return bookings.filter(
    (booking) => booking.firstDay <= day && day <= booking.lastDay,
  );
}

/** The bookings a new one starting `startDay` for `durationDays` would overlap. */
export function overlappingBookings(
  bookings: readonly TradieBooking[],
  startDay: string,
  durationDays: number,
): TradieBooking[] {
  const lastDay = addDays(startDay, Math.max(1, durationDays) - 1);
  return bookings.filter(
    (booking) => booking.firstDay <= lastDay && startDay <= booking.lastDay,
  );
}

const displayDay = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

/** "12 Oct 2026" or "12 Oct 2026 – 14 Oct 2026". */
export function bookingWindow(booking: TradieBooking): string {
  const first = displayDay.format(new Date(`${booking.firstDay}T00:00:00Z`));
  if (booking.firstDay === booking.lastDay) return first;
  const last = displayDay.format(new Date(`${booking.lastDay}T00:00:00Z`));
  return `${first} – ${last}`;
}

/** "Smith residence · Framing, 12 Oct 2026 – 14 Oct 2026". */
export function describeBooking(booking: TradieBooking): string {
  const work = booking.projectName
    ? [booking.projectName, booking.milestoneName].filter(Boolean).join(" · ")
    : "Another project";
  return `${work}, ${bookingWindow(booking)}`;
}
