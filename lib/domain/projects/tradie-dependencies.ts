import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";

import { bookingTrade, sameTrade } from "../tradies/request-rules";

type DependentMilestone = {
  id: string;
  status: MilestoneStatus;
  requiredTradeTypes?: readonly { label: string }[];
};
type Booking = {
  milestoneId: string | null;
  status: TradieScheduleStatus;
  /** The trade it is for; see `bookingTrade`. */
  trade?: string | null;
  tradie: { trade: string };
};

/**
 * The trades an active activity still has no confirmed booking for. Each
 * required trade needs its own; a booking elsewhere on the job, or one
 * awaiting approval/confirmation, does not cover this activity.
 */
export function missingMilestoneTrades(
  milestone: DependentMilestone,
  bookings: readonly Booking[],
): string[] {
  if (milestone.status !== MilestoneStatus.ACTIVE) return [];
  return (milestone.requiredTradeTypes ?? [])
    .map((trade) => trade.label)
    .filter(
      (label) =>
        !bookings.some(
          (booking) =>
            booking.milestoneId === milestone.id
            && booking.status === TradieScheduleStatus.CONFIRMED
            && sameTrade(bookingTrade(booking), label),
        ),
    );
}
