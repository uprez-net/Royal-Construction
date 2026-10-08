import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";

import { INACTIVE_SCHEDULE_STATUSES } from "./lifecycle";

// When a tradie booking is still worth an alert.
//
// Every tradie alert in the app is derived from the booking rather than
// stored, and the derivations only ever asked "is this status one we chase?"
// — never "is the moment for chasing it over?". So an alert went away only if
// someone moved the booking by hand, and a declined tradie asked for a
// replacement long after one had been booked. This is the one answer to "is
// it over?"; the screens keep their own wording for what to say about it.
//
// Pure, with structural inputs, so the screens can call it on the project
// payload they already hold and the tests can call it on literals.

export type AlertBooking = {
  readonly id: string;
  readonly status: TradieScheduleStatus;
  readonly scheduledDate: Date | string;
  readonly durationDays: number;
  readonly milestoneId: string | null;
  readonly alertDismissedStatus?: TradieScheduleStatus | null;
  readonly milestone?: { readonly status: MilestoneStatus } | null;
  readonly tradie: { readonly trade: string };
};

/** A booking date, which is stored at UTC midnight, as YYYY-MM-DD. */
function bookingDay(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** The booking's last day on site, as YYYY-MM-DD. */
export function bookingLastDay(booking: {
  readonly scheduledDate: Date | string;
  readonly durationDays: number;
}): string {
  const start = new Date(booking.scheduledDate);
  const days = Math.max(1, booking.durationDays);
  return bookingDay(new Date(start.getTime() + (days - 1) * 86_400_000));
}

/**
 * Another booking that already covers this one's work: the same trade, on the
 * same milestone (or both general), still active.
 */
export function hasReplacementBooking(
  booking: AlertBooking,
  projectBookings: readonly AlertBooking[],
): boolean {
  return projectBookings.some(
    (other) =>
      other.id !== booking.id
      && other.milestoneId === booking.milestoneId
      && other.tradie.trade === booking.tradie.trade
      && !INACTIVE_SCHEDULE_STATUSES.includes(other.status),
  );
}

/**
 * Whether a booking's alert should still show.
 *
 * Over, in order:
 * - dismissed while the booking is still in the status it was dismissed at;
 * - its milestone is settled — done or not required, nothing left to book for;
 * - it is completed;
 * - its dates are behind us: an approved booking once its last day has
 *   passed (a job runs to the end of its days), anything else once its start
 *   has (chasing an answer for a date that is gone is not a follow-up);
 * - declined or removed, and another booking of the same trade on the same
 *   milestone has replaced it.
 *
 * @param today Sydney calendar date, YYYY-MM-DD — the date on site.
 */
export function isTradieAlertLive(
  booking: AlertBooking,
  projectBookings: readonly AlertBooking[],
  today: string,
): boolean {
  if (booking.alertDismissedStatus === booking.status) return false;

  const milestoneStatus = booking.milestone?.status;
  if (
    milestoneStatus === MilestoneStatus.DONE
    || milestoneStatus === MilestoneStatus.NOT_REQUIRED
  ) {
    return false;
  }

  switch (booking.status) {
    case TradieScheduleStatus.COMPLETED:
      return false;
    case TradieScheduleStatus.CONFIRMED:
    case TradieScheduleStatus.PENDING_FINAL_CONFIRMATION:
      return bookingLastDay(booking) >= today;
    case TradieScheduleStatus.DECLINED:
    case TradieScheduleStatus.CANCELLED:
      return (
        bookingDay(booking.scheduledDate) >= today
        && !hasReplacementBooking(booking, projectBookings)
      );
    default:
      return bookingDay(booking.scheduledDate) >= today;
  }
}
