import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";

type DependentMilestone = {
  id: string;
  status: MilestoneStatus;
  requiredTradeType?: { label: string } | null;
};
type Booking = {
  milestoneId: string | null;
  status: TradieScheduleStatus;
  tradie: { trade: string };
};

/** A booking elsewhere on the job, or awaiting approval/confirmation, does not cover this activity. */
export function missingMilestoneTrade(
  milestone: DependentMilestone,
  bookings: readonly Booking[],
): string | null {
  const label = milestone.requiredTradeType?.label;
  if (milestone.status !== MilestoneStatus.ACTIVE || !label) return null;
  const confirmed = bookings.some(
    (booking) =>
      booking.milestoneId === milestone.id
      && booking.status === TradieScheduleStatus.CONFIRMED
      && booking.tradie.trade === label,
  );
  return confirmed ? null : label;
}
