import { TradieScheduleStatus } from "@prisma/client";

// What moving a booking's dates does to it.
//
// A tradie's answer is an answer about a date. Once the date moves, the answer
// no longer covers it, so the booking has to go back to the tradie — but how
// far back depends on whether the office had already approved it:
//
//   - Approved (CONFIRMED, or PENDING_FINAL_CONFIRMATION waiting on the
//     tradie's last word): the approval stands. The price and the tradie were
//     approved, not the day. The booking waits on the tradie's confirmation
//     for the new date, and their "yes" confirms it with no second approval
//     (`tradieReplyStatus` already maps a yes on PENDING_FINAL_CONFIRMATION
//     straight to CONFIRMED).
//   - Waiting on an admin (AWAITING_ADMIN_APPROVAL): the tradie said yes to
//     the *old* date, and the approval in the queue says so. Approving it would
//     approve a day nobody agreed to, so the approval is withdrawn and the
//     booking goes back to waiting on the tradie. Their yes for the new date
//     raises a fresh approval with the right date on it.
//   - Still waiting on the tradie (pending, unanswered, quoting): nothing to
//     undo. The status stays as it is and the tradie is asked again, about the
//     new date.
//   - Declined, completed or removed: history. A declined tradie is replaced
//     by a new booking, not revived by moving an old one, because the
//     duplicate check ignores declined bookings and a revived one could sit
//     beside its own replacement.
//
// Pure, so the reschedule dialog can say what will happen — and pick the
// email that says it — from the same rule the command applies.

/** Which email a reschedule sends the tradie. */
export type RescheduleNotice =
  /** Not yet approved: confirm availability for the new date. */
  | "confirm-availability"
  /** Already approved: just confirm attendance on the new date. */
  | "reconfirm-attendance";

export type RescheduleOutcome = {
  /** The status the booking is written with. */
  readonly status: TradieScheduleStatus;
  readonly notice: RescheduleNotice;
  /** A pending schedule approval for the old date is withdrawn. */
  readonly withdrawsApproval: boolean;
};

const APPROVED: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.CONFIRMED,
  TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
];

const NOT_RESCHEDULABLE: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.CANCELLED,
  TradieScheduleStatus.COMPLETED,
  TradieScheduleStatus.DECLINED,
];

/** `null` when a booking in this status cannot be rescheduled at all. */
export function rescheduleOutcome(
  status: TradieScheduleStatus,
): RescheduleOutcome | null {
  if (NOT_RESCHEDULABLE.includes(status)) return null;
  if (APPROVED.includes(status)) {
    return {
      notice: "reconfirm-attendance",
      status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      withdrawsApproval: false,
    };
  }
  if (status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL) {
    return {
      notice: "confirm-availability",
      status: TradieScheduleStatus.PENDING_RESPONSE,
      withdrawsApproval: true,
    };
  }
  return { notice: "confirm-availability", status, withdrawsApproval: false };
}

/** The operator-facing refusal for a status `rescheduleOutcome` rejects. */
export function notReschedulableReason(status: TradieScheduleStatus): string {
  switch (status) {
    case TradieScheduleStatus.DECLINED:
      return "This tradie declined the booking. Book a replacement instead of moving it.";
    case TradieScheduleStatus.COMPLETED:
      return "This booking is already completed and cannot be rescheduled.";
    default:
      return "A cancelled booking cannot be rescheduled.";
  }
}
