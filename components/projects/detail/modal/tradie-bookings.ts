import type { TradieBooking } from "@/lib/domain/tradies/schedules";

// Day arithmetic for the schedule modal, on `YYYY-MM-DD` strings so a browser
// timezone can never shift a booking by a day. A booking holds `durationDays`
// working days from its first one. Booked days are marked, not refused: the
// only booking the server refuses is the same one twice
// (`assertNotAlreadyBooked`), which `existingBooking` mirrors.

export type { TradieBooking };

/** The bookings that hold the tradie on this day. */
export function bookingsOn(
  bookings: readonly TradieBooking[],
  day: string,
): TradieBooking[] {
  return bookings.filter(
    (booking) => booking.firstDay <= day && day <= booking.lastDay,
  );
}

/**
 * The active booking this tradie already holds on this project and milestone,
 * which the server would refuse to duplicate. No milestone matches no
 * milestone.
 */
export function existingBooking(
  bookings: readonly TradieBooking[],
  projectId: string,
  milestoneId: string | null | undefined,
): TradieBooking | undefined {
  return bookings.find(
    (booking) =>
      booking.projectId === projectId
      && booking.milestoneId === (milestoneId || null),
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
