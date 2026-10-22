import {
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieScheduleStatus,
} from "@prisma/client";

import { sydneyDateOnly } from "@/lib/dates/sydney";

import type { DomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import {
  noteTradieActivity,
  recordTradieActivity,
} from "../audit/tradie-activity-log";
import { TRADIE_REMINDER_CRON } from "@/types/tradieActivityLog";

import {
  INACTIVE_SCHEDULE_STATUSES,
  settledBookingStatus,
  type MilestoneSettlement,
} from "./lifecycle";
import { bookingLastDay } from "./alert-rules";

// The cascades that close a booking without anybody touching it.
//
// Before these, a booking only ever left an open status when someone moved it
// by hand, and nobody does once the work is over: a finished milestone kept
// its confirmed tradie "confirmed" for ever, its unanswered requests kept
// asking for follow-ups, and every one of them kept alerting.

export type SettledBookings = {
  readonly completed: readonly string[];
  readonly cancelled: readonly string[];
};

/** Why each booking closed, on the tradie's history. */
const SETTLED_BOOKING_REASON: Record<MilestoneSettlement, string> = {
  DONE: "the activity was marked done",
  NOT_REQUIRED: "the activity was marked not required",
};

const SETTLEMENT_REASON: Record<MilestoneSettlement, string> = {
  DONE: "The milestone was completed, so this booking was settled with it.",
  NOT_REQUIRED:
    "The milestone was marked not required, so this booking was cancelled.",
};

/**
 * Settle every open booking on a milestone that has just been settled.
 *
 * Not a command on its own: `updateMilestone` authorizes and runs this in the
 * transaction that settles the milestone (and again for a parent the update
 * rolled up), so a finished milestone is never left holding open bookings.
 * Approvals still waiting on those bookings — an admin approval, a removal
 * request — are closed with them, so the admin queue does not ask about work
 * that is over. No email goes to the tradie.
 */
export async function settleMilestoneBookings(
  input: {
    readonly milestoneId: string;
    readonly settlement: MilestoneSettlement;
    /** Who settled the milestone, for the tradies' histories. */
    readonly principal?: DomainPrincipal | null;
  },
  db: DomainDb,
): Promise<SettledBookings> {
  const open = await db.tradieSchedule.findMany({
    select: { id: true, projectId: true, status: true, tradieId: true },
    where: {
      milestoneId: input.milestoneId,
      status: { notIn: INACTIVE_SCHEDULE_STATUSES },
    },
  });
  if (open.length === 0) return { cancelled: [], completed: [] };

  const completed: string[] = [];
  const cancelled: string[] = [];
  for (const booking of open) {
    const next = settledBookingStatus(booking.status, input.settlement);
    if (next === TradieScheduleStatus.COMPLETED) completed.push(booking.id);
    if (next === TradieScheduleStatus.CANCELLED) cancelled.push(booking.id);
  }

  const rejected = {
    pendingDeletionKey: null,
    rejectionReason: SETTLEMENT_REASON[input.settlement],
    status: TradieApprovalStatus.REJECTED,
  };
  await db.tradieApproval.updateMany({
    data: rejected,
    where: {
      actionType: TradieApprovalActionType.SCHEDULE_DELETION,
      pendingDeletionKey: { in: [...completed, ...cancelled] },
      status: TradieApprovalStatus.PENDING,
    },
  });
  for (const scheduleId of cancelled) {
    await db.tradieApproval.updateMany({
      data: rejected,
      where: {
        actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
        status: TradieApprovalStatus.PENDING,
        updationData: { equals: scheduleId, path: ["scheduleId"] },
      },
    });
  }

  // One booking at a time, conditional on its status still being open: a
  // booking another request settled a moment ago keeps what that request gave
  // it, and is not put on the tradie's history a second time.
  const reason = SETTLED_BOOKING_REASON[input.settlement];
  const principal = input.principal ?? null;
  const settled: { completed: string[]; cancelled: string[] } = {
    cancelled: [],
    completed: [],
  };
  for (const booking of open) {
    const done = completed.includes(booking.id);
    if (!done && !cancelled.includes(booking.id)) continue;
    const updated = await db.tradieSchedule.updateMany({
      data: {
        status: done
          ? TradieScheduleStatus.COMPLETED
          : TradieScheduleStatus.CANCELLED,
      },
      where: {
        id: booking.id,
        status: { notIn: INACTIVE_SCHEDULE_STATUSES },
      },
    });
    if (updated.count !== 1) continue;
    (done ? settled.completed : settled.cancelled).push(booking.id);
    const data = {
      milestoneId: input.milestoneId,
      projectId: booking.projectId,
      reason,
      scheduleId: booking.id,
      tradieId: booking.tradieId,
    };
    await recordTradieActivity(
      done
        ? { data, principal, type: "bookingCompleted" }
        : { data, principal, type: "bookingCancelled" },
      db,
    );
  }

  return settled;
}

/**
 * Complete every confirmed booking whose last day on site has passed.
 *
 * Run daily by the tradie-reminder cron. A confirmed booking is the office's
 * record that the tradie is coming; once the days are behind us it has
 * happened, and leaving it "confirmed" kept it on the milestone with a
 * reminder bell beside it indefinitely. Sydney's date decides "passed",
 * because that is the date on site.
 */
export async function completeElapsedBookings(
  now: Date,
  db: DomainDb,
): Promise<{ completed: number }> {
  const today = sydneyDateOnly(now);

  const candidates = await db.tradieSchedule.findMany({
    select: {
      durationDays: true,
      id: true,
      milestoneId: true,
      projectId: true,
      scheduledDate: true,
      tradieId: true,
    },
    where: {
      // Started before today, or it cannot have finished before today.
      scheduledDate: { lt: new Date(`${today}T00:00:00.000Z`) },
      status: TradieScheduleStatus.CONFIRMED,
    },
  });
  const elapsedBookings = candidates.filter(
    (booking) => bookingLastDay(booking) < today,
  );
  if (elapsedBookings.length === 0) return { completed: 0 };

  // One booking at a time, so only a booking this run actually moved goes on
  // the tradie's history: one someone changed since the read keeps theirs.
  let completed = 0;
  for (const booking of elapsedBookings) {
    const updated = await db.tradieSchedule.updateMany({
      data: { status: TradieScheduleStatus.COMPLETED },
      where: { id: booking.id, status: TradieScheduleStatus.CONFIRMED },
    });
    if (updated.count !== 1) continue;
    completed += 1;
    // A cron with no transaction around it: noted, never thrown.
    await noteTradieActivity(
      {
        data: {
          milestoneId: booking.milestoneId,
          projectId: booking.projectId,
          reason: "its last day on site has passed",
          scheduleId: booking.id,
          tradieId: booking.tradieId,
          via: TRADIE_REMINDER_CRON,
        },
        principal: null,
        type: "bookingCompleted",
      },
      db,
    );
  }
  return { completed };
}
