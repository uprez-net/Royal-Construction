import {
  CommsDirection,
  OutboxEventKind,
  TradieScheduleStatus,
} from "@prisma/client";

import { assertCanBookTradies } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainTransitionError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { runOutboxEffectWithOutcome } from "../outbox";
import { INACTIVE_SCHEDULE_STATUSES } from "./lifecycle";
import { noteTradieEmail } from "./emails";
import { subjectWithTradieRef } from "./reply-reference";
import {
  noteTradieActivity,
  recordTradieActivity,
} from "../audit/tradie-activity-log";
import { TRADIE_REMINDER_CRON } from "@/types/tradieActivityLog";

const NON_ACTIONABLE_STATUSES = new Set<TradieScheduleStatus>(
  INACTIVE_SCHEDULE_STATUSES,
);

export type TradieReminderEmailPort = (input: {
  readonly body: string;
  readonly subject: string;
  readonly to: string;
}) => Promise<void>;

/**
 * Send a manually requested reminder through the same durable effect guard.
 *
 * The caller's idempotency key is scoped to the day it is used. The modal
 * builds the subject and body deterministically from the schedule, so an
 * unscoped content hash deduplicated *for ever*: the office sends a reminder
 * on Monday, hears nothing, sends the same one on Thursday, and the second one
 * is silently swallowed while the screen says it was sent. A day is long
 * enough to cover the double-click and the retry-after-timeout this guard is
 * actually for, and short enough that a deliberate resend goes out. A replay
 * inside that day is reported as one rather than as a fresh send.
 *
 * The subject always leaves with the booking's reference on it, whatever the
 * office typed over the modal's suggestion: the tradie's reply is matched on
 * it, and losing it puts the reply back to being guessed.
 */
export async function sendTradieScheduleReminder(
  principal: DomainPrincipal,
  input: {
    readonly body: string;
    readonly idempotencyKey: string;
    readonly scheduleId: string;
    readonly subject: string;
    /** Overridable so a test does not depend on the wall clock. */
    readonly now?: Date;
  },
  db: DomainDb,
  send: TradieReminderEmailPort,
): Promise<{ to: string; alreadySent: boolean }> {
  assertCanBookTradies(principal);
  if (!isInternalPrincipal(principal)) {
    throw new DomainTransitionError(
      "Sending schedule reminders requires internal staff access.",
    );
  }
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      milestoneId: true,
      projectId: true,
      refToken: true,
      status: true,
      tradie: { select: { email: true, archivedAt: true } },
      tradieId: true,
    },
    where: { id: input.scheduleId },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found.");
  if (
    schedule.status === TradieScheduleStatus.CANCELLED
    || schedule.tradie.archivedAt
  ) {
    throw new DomainTransitionError(
      "A removed tradie cannot receive booking reminders.",
    );
  }
  const to = schedule.tradie.email.trim();
  if (!to) throw new DomainTransitionError("This tradie has no email address.");

  const subject = subjectWithTradieRef(input.subject, schedule.refToken);
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const { replayed } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `tradie-manual-reminder:${day}:${input.idempotencyKey}`,
      kind: OutboxEventKind.TRADIE_SCHEDULE_MANUAL_REMINDER,
      payload: {
        body: input.body,
        scheduleId: input.scheduleId,
        subject,
        to,
      },
    },
    async () => {
      await send({ body: input.body, subject, to });
      return { to };
    },
  );
  if (!replayed) {
    await noteTradieActivity(
      {
        data: {
          milestoneId: schedule.milestoneId,
          projectId: schedule.projectId,
          scheduleId: input.scheduleId,
          subject,
          tradieId: schedule.tradieId,
        },
        principal,
        type: "bookingEmailSent",
      },
      db,
    );
    // On the tradie's project thread, so the reply it prompts has its question
    // beside it.
    await noteTradieEmail(
      {
        body: input.body,
        direction: CommsDirection.OUTBOUND,
        emailTo: to,
        projectId: schedule.projectId,
        refToken: schedule.refToken,
        scheduleId: input.scheduleId,
        sentAt: input.now ?? new Date(),
        subject,
        tradieId: schedule.tradieId,
      },
      db,
    );
  }
  return { alreadySent: replayed, to };
}

/** The schedule rows and eligible subset for the weekly reminder worker. */
export async function findTradieReminderWindow(
  windowStart: Date,
  windowEnd: Date,
  db: DomainDb,
) {
  const schedules = await db.tradieSchedule.findMany({
    where: {
      scheduledDate: { gte: windowStart, lte: windowEnd },
    },
    include: {
      tradie: true,
      project: { include: { siteManager: true } },
      milestone: true,
    },
  });
  const actionable = schedules.filter(
    (schedule) =>
      schedule.reminderSentAt === null
      && !NON_ACTIONABLE_STATUSES.has(schedule.status),
  );
  return { actionable, schedules };
}

/**
 * Commit the reminder result exactly once and apply its state transition.
 * A second worker can observe the same outbox payload, but its conditional
 * write returns false and cannot move the schedule a second time.
 */
export async function markTradieReminderSent(
  scheduleId: string,
  db: DomainDb,
  sentAt = new Date(),
): Promise<{ alreadySent: boolean; status: TradieScheduleStatus }> {
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      milestoneId: true,
      projectId: true,
      reminderSentAt: true,
      status: true,
      tradieId: true,
    },
    where: { id: scheduleId },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found.");
  if (schedule.reminderSentAt) {
    return { alreadySent: true, status: schedule.status };
  }
  if (NON_ACTIONABLE_STATUSES.has(schedule.status)) {
    throw new DomainTransitionError(
      "A completed, declined or cancelled schedule cannot receive a reminder.",
    );
  }

  const status =
    schedule.status === TradieScheduleStatus.CONFIRMED
      ? TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
      : schedule.status === TradieScheduleStatus.PENDING
        ? TradieScheduleStatus.PENDING_RESPONSE
        : schedule.status;
  // The move and its history entry commit together. Recorded, not noted: a
  // swallowed failure inside a caller's transaction would abort it while this
  // reported the reminder as recorded.
  const advance = async (tx: DomainDb): Promise<boolean> => {
    const updated = await tx.tradieSchedule.updateMany({
      data: { reminderSentAt: sentAt, status },
      where: { id: scheduleId, reminderSentAt: null },
    });
    if (updated.count !== 1) return false;
    if (status !== schedule.status) {
      await recordTradieActivity(
        {
          data: {
            from: schedule.status,
            milestoneId: schedule.milestoneId,
            projectId: schedule.projectId,
            scheduleId,
            to: status,
            tradieId: schedule.tradieId,
            via: TRADIE_REMINDER_CRON,
          },
          principal: null,
          type: "bookingStatusChanged",
        },
        tx,
      );
    }
    return true;
  };
  const advanced =
    "$transaction" in db ? await db.$transaction(advance) : await advance(db);
  if (advanced) return { alreadySent: false, status };

  const current = await db.tradieSchedule.findUnique({
    select: { reminderSentAt: true, status: true },
    where: { id: scheduleId },
  });
  if (!current) throw new DomainNotFoundError("Schedule not found.");
  if (current.reminderSentAt) {
    return { alreadySent: true, status: current.status };
  }
  throw new DomainTransitionError(
    "The schedule changed before its reminder was recorded.",
  );
}
