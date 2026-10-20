import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";

type DependentMilestone = {
  id: string;
  status: MilestoneStatus;
  requiredTradeTypes?: readonly { label: string }[];
};
type Booking = {
  milestoneId: string | null;
  status: TradieScheduleStatus;
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
            && booking.tradie.trade === label,
        ),
    );
}
