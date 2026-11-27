import {
  MilestoneStatus,
  type ProjectStatus,
  TradieScheduleStatus,
} from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";

import { INACTIVE_SCHEDULE_STATUSES } from "../tradies/lifecycle";
import { bookingTrade, sameTrade } from "../tradies/request-rules";
import { isProjectBuilding } from "./milestone-schedule";

// When an activity's tradie bookings are overdue.
//
// A tradie is booked BEFORE the activity starts: the booking has to be
// confirmed well ahead of the day the work is meant to begin, because a trade
// chased on the morning it is needed is a trade that does not turn up. So an
// activity's bookings fall due `BOOKING_LOOKAHEAD_DAYS` before its start day,
// not on its estimated end (that is the activity itself being overdue,
// `openOverdueDays`):
//
//   - an activity under way (ACTIVE) has started, so its bookings are due now,
//     whatever the project's status says;
//   - a pending activity on a job being built is due once its planned start
//     day (`targetDate`) is `BOOKING_LOOKAHEAD_DAYS` away or closer, and stays
//     due through the start day and after it. A job still in drafting or
//     compliance is left out, for the reason `openOverdueDays` gives: its
//     planned dates run from a start date nobody has reached yet.
//
// Once due, every trade the activity requires needs a CONFIRMED booking on
// this activity, and a tradie booked on it but not yet confirmed is overdue as
// well. One rule for the Milestones tab, the project's Alerts card, Needs
// Attention and the Projects list's Overdue filter.

/**
 * How far ahead of an activity's planned start its bookings must be confirmed:
 * two weeks, so a missing or unconfirmed trade shows up while there is still
 * time to find one.
 */
export const BOOKING_LOOKAHEAD_DAYS = 14;

type DependentMilestone = {
  id: string;
  status: MilestoneStatus;
  /** Planned start. */
  targetDate: Date | string;
  requiredTradeTypes?: readonly { label: string }[];
};
type Booking = {
  milestoneId: string | null;
  status: TradieScheduleStatus;
  /** The trade it is for; see `bookingTrade`. */
  trade?: string | null;
  tradie: { trade: string };
};

/** One trade on one activity whose booking is overdue. */
export type BookingGap = {
  readonly trade: string;
  /**
   * A tradie is booked for it on this activity but has not confirmed: still
   * pending, waiting on a quote, an answer, an approval or a final
   * confirmation. False when nobody live is booked for it at all.
   */
  readonly unconfirmed: boolean;
};

/**
 * Whether an activity's bookings must be confirmed by `today`: under way, or
 * pending on a job being built with its planned start day no more than
 * `BOOKING_LOOKAHEAD_DAYS` away (or already past).
 *
 * `today` is compared by calendar day in the process's time zone; a server
 * caller moves both dates onto Sydney's wall clock first.
 */
export function bookingsDue(
  milestone: Pick<DependentMilestone, "status" | "targetDate">,
  today: Date,
  projectStatus: ProjectStatus,
): boolean {
  if (milestone.status === MilestoneStatus.ACTIVE) return true;
  return (
    milestone.status === MilestoneStatus.PENDING
    && isProjectBuilding(projectStatus)
    && differenceInCalendarDays(new Date(milestone.targetDate), today)
      <= BOOKING_LOOKAHEAD_DAYS
  );
}

/** Not yet confirmed, and not over: the tradie may still say yes. */
function awaitingConfirmation(status: TradieScheduleStatus): boolean {
  return (
    status !== TradieScheduleStatus.CONFIRMED
    && !INACTIVE_SCHEDULE_STATUSES.includes(status)
  );
}

/**
 * The trades whose booking on this activity is overdue, required trades first.
 *
 * Each required trade needs its own confirmed booking; a booking elsewhere on
 * the job, or one awaiting approval or confirmation, does not cover this
 * activity. A tradie booked here for a trade the activity does not list is
 * overdue too while unconfirmed, unless another tradie in that trade has
 * confirmed. Empty until the activity's bookings are due (`bookingsDue`).
 */
export function overdueMilestoneBookings(
  milestone: DependentMilestone,
  bookings: readonly Booking[],
  today: Date,
  projectStatus: ProjectStatus,
): BookingGap[] {
  if (!bookingsDue(milestone, today, projectStatus)) return [];
  const own = bookings.filter(
    (booking) => booking.milestoneId === milestone.id,
  );
  const confirmed = (trade: string) =>
    own.some(
      (booking) =>
        booking.status === TradieScheduleStatus.CONFIRMED
        && sameTrade(bookingTrade(booking), trade),
    );
  const pending = own.filter((booking) => awaitingConfirmation(booking.status));

  const gaps: BookingGap[] = (milestone.requiredTradeTypes ?? [])
    .map((trade) => trade.label)
    .filter((trade) => !confirmed(trade))
    .map((trade) => ({
      trade,
      unconfirmed: pending.some((booking) =>
        sameTrade(bookingTrade(booking), trade),
      ),
    }));
  for (const booking of pending) {
    const trade = bookingTrade(booking);
    if (confirmed(trade) || gaps.some((gap) => sameTrade(gap.trade, trade))) {
      continue;
    }
    gaps.push({ trade, unconfirmed: true });
  }
  return gaps;
}

/** "No confirmed Plumbing booking" / "Plumbing booked, not confirmed". */
export function bookingGapLabel(gap: BookingGap): string {
  return gap.unconfirmed
    ? `${gap.trade} booked, not confirmed`
    : `No confirmed ${gap.trade} booking`;
}
