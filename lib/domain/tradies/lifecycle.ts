import {
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieScheduleStatus,
} from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainTransitionError } from "../errors";
import {
  parseQuotedAmount,
  scheduleTotalCost,
} from "../../../utils/calculations";

/** Completed, declined and cancelled bookings no longer reserve work. */
export const INACTIVE_SCHEDULE_STATUSES: TradieScheduleStatus[] = [
  TradieScheduleStatus.DECLINED,
  TradieScheduleStatus.COMPLETED,
  TradieScheduleStatus.CANCELLED,
];

export async function requireActiveTradie(tradieId: string, db: DomainDb) {
  return activeTradie(await db.tradie.findUnique({ where: { id: tradieId } }));
}

/** The one not-found and removed check, for both reads below. */
function activeTradie<T extends { archivedAt: Date | null }>(
  tradie: T | null,
): T {
  if (!tradie) throw new DomainNotFoundError("Tradie not found.");
  if (tradie.archivedAt) {
    throw new DomainTransitionError(
      "This tradie has been removed from the active directory.",
    );
  }
  return tradie;
}

/**
 * A tradie who can take new work: active, and with no removal request waiting
 * (issue #529). Booking someone the office has asked to remove only adds a
 * booking the removal then has to cancel, so new work waits until the removal
 * is approved or rejected. Work already booked is not affected.
 */
export async function requireBookableTradie(tradieId: string, db: DomainDb) {
  const tradie = activeTradie(
    await db.tradie.findUnique({
      where: { id: tradieId },
      include: {
        approvals: {
          where: {
            actionType: TradieApprovalActionType.TRADIE_REMOVAL,
            status: TradieApprovalStatus.PENDING,
          },
          select: { id: true },
          take: 1,
        },
      },
    }),
  );
  if (tradie.approvals?.length) {
    throw new DomainTransitionError(
      `${tradie.name} has a removal request waiting for approval, so they cannot take new work. Approve or reject the removal first.`,
    );
  }
  return tradie;
}

/**
 * What a booking costs the milestone. Removed bookings remain in history but
 * cannot inflate it.
 *
 * A recorded price wins: a quote, or the price the office entered for a tradie
 * booked without one. Only a booking with no price at all is costed from the
 * tradie's rate, and a booking still waiting on its quote costs nothing yet.
 *
 * The recorded price is read with `parseQuotedAmount`, not `parseFloat`: a
 * price written before quotes were normalised can still read "$4,500", which
 * `parseFloat` makes NaN, and "1,200.00", which it makes 1.
 */
export function tradieScheduleSpend(schedule: {
  status: TradieScheduleStatus;
  requiresQuote: boolean;
  quotedPrice: string | null;
  durationDays: number;
  tradie: {
    lastQuotedPrice?: string | null;
    lastQuotedPriceUnit: "HOURLY" | "FIXED";
  };
}): number {
  if (schedule.status === TradieScheduleStatus.CANCELLED) return 0;
  if (schedule.quotedPrice) return parseQuotedAmount(schedule.quotedPrice) ?? 0;
  return schedule.requiresQuote
    ? 0
    : scheduleTotalCost(
        parseFloat(schedule.tradie.lastQuotedPrice ?? "0"),
        schedule.durationDays,
        schedule.tradie.lastQuotedPriceUnit,
      );
}

/** How a milestone was settled, as far as the bookings on it are concerned. */
export type MilestoneSettlement = "DONE" | "NOT_REQUIRED";

/**
 * What settling a milestone does to one booking on it; `null` leaves it alone.
 *
 * A finished milestone means the approved bookings on it did the work, so they
 * complete. Anything never approved — still pending, unanswered, waiting on a
 * quote or on an admin — never will be, so it is cancelled. A milestone waived
 * as not required cancels every open booking. Bookings already declined,
 * completed or cancelled are history and stay as they are.
 *
 * Pure, so the milestone dialog can price the spend against the statuses the
 * server is about to write rather than the ones it is about to replace.
 */
export function settledBookingStatus(
  status: TradieScheduleStatus,
  settlement: MilestoneSettlement,
): TradieScheduleStatus | null {
  if (INACTIVE_SCHEDULE_STATUSES.includes(status)) return null;

  const approved =
    status === TradieScheduleStatus.CONFIRMED
    || status === TradieScheduleStatus.PENDING_FINAL_CONFIRMATION;

  return settlement === "DONE" && approved
    ? TradieScheduleStatus.COMPLETED
    : TradieScheduleStatus.CANCELLED;
}
