import { OutboxEventKind, TradieScheduleStatus } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainTransitionError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { runOutboxEffect } from "../outbox";

const NON_ACTIONABLE_STATUSES = new Set<TradieScheduleStatus>([
  TradieScheduleStatus.DECLINED,
  TradieScheduleStatus.COMPLETED,
]);

export type TradieReminderEmailPort = (input: {
  readonly body: string;
  readonly subject: string;
  readonly to: string;
}) => Promise<void>;

/** Send a manually requested reminder through the same durable effect guard. */
export async function sendTradieScheduleReminder(
  principal: DomainPrincipal,
  input: {
    readonly body: string;
    readonly idempotencyKey: string;
    readonly scheduleId: string;
    readonly subject: string;
  },
  db: DomainDb,
  send: TradieReminderEmailPort,
): Promise<{ to: string }> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainTransitionError(
      "Sending schedule reminders requires internal staff access.",
    );
  }
  const schedule = await db.tradieSchedule.findUnique({
    select: { tradie: { select: { email: true } } },
    where: { id: input.scheduleId },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found.");
  const to = schedule.tradie.email.trim();
  if (!to) throw new DomainTransitionError("This tradie has no email address.");

  await runOutboxEffect(
    db,
    {
      key: `tradie-manual-reminder:${input.idempotencyKey}`,
      kind: OutboxEventKind.TRADIE_SCHEDULE_MANUAL_REMINDER,
      payload: {
        body: input.body,
        scheduleId: input.scheduleId,
        subject: input.subject,
        to,
      },
    },
    async () => {
      await send({ body: input.body, subject: input.subject, to });
      return { to };
    },
  );
  return { to };
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
      schedule.reminderSentAt === null &&
      !NON_ACTIONABLE_STATUSES.has(schedule.status),
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
    select: { reminderSentAt: true, status: true },
    where: { id: scheduleId },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found.");
  if (schedule.reminderSentAt) {
    return { alreadySent: true, status: schedule.status };
  }
  if (NON_ACTIONABLE_STATUSES.has(schedule.status)) {
    throw new DomainTransitionError(
      "A completed or declined schedule cannot receive a reminder.",
    );
  }

  const status =
    schedule.status === TradieScheduleStatus.CONFIRMED
      ? TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
      : schedule.status === TradieScheduleStatus.PENDING
        ? TradieScheduleStatus.PENDING_RESPONSE
        : schedule.status;
  const updated = await db.tradieSchedule.updateMany({
    data: { reminderSentAt: sentAt, status },
    where: { id: scheduleId, reminderSentAt: null },
  });
  if (updated.count === 1) return { alreadySent: false, status };

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
