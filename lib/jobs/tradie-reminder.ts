import { addDays, endOfDay, startOfDay } from "date-fns";
import {
  OutboxEventKind,
  TradieScheduleStatus,
  type Prisma,
} from "@prisma/client";

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/azureClient";
import { generateTradieFinalConfirmationEmail } from "@/utils/generate-email";
import type { TradieScheduleListItem } from "@/types/project";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failOutboxEvent,
} from "@/lib/domain/outbox";
import {
  findTradieReminderWindow,
  markTradieReminderSent,
} from "@/lib/domain/tradies/reminders";
import { completeElapsedBookings } from "@/lib/domain/tradies/settlement";

/**
 * Settling one event must never end the run. failOutboxEvent throws when the
 * event is no longer RUNNING — which is exactly the state a failure *after*
 * the event was completed leaves it in — and an uncaught throw here skipped
 * every reminder still queued behind it. With nobody watching this cron, that
 * is a week of tradies not reminded because one row was odd.
 */
async function settleFailure(eventId: string, message: string): Promise<void> {
  try {
    await failOutboxEvent(prisma, eventId, { message, retryable: false });
  } catch (error) {
    console.error(
      `[REMINDER] Could not mark outbox event ${eventId} failed:`,
      error,
    );
  }
}

function scheduleIdFromPayload(payload: Prisma.JsonValue): string | null {
  if (
    typeof payload !== "object"
    || payload === null
    || Array.isArray(payload)
    || typeof payload.scheduleId !== "string"
    || !payload.scheduleId.trim()
  ) {
    return null;
  }
  return payload.scheduleId;
}

export async function sendTradieReminders(): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  completed: number;
}> {
  // First, so a booking whose days are already behind it is closed rather than
  // reminded. Its own step: a failure here must not cost the week's reminders.
  let completed = 0;
  try {
    ({ completed } = await completeElapsedBookings(new Date(), prisma));
  } catch (error) {
    console.error("[REMINDER] Could not complete elapsed bookings:", error);
  }

  const targetDate = addDays(startOfDay(new Date()), 7);
  const windowStart = startOfDay(targetDate);
  const windowEnd = endOfDay(targetDate);
  const window = await findTradieReminderWindow(windowStart, windowEnd, prisma);

  for (const schedule of window.actionable) {
    await enqueueOutboxEvent(prisma, {
      key: `tradie-reminder:${schedule.id}`,
      kind: OutboxEventKind.TRADIE_SCHEDULE_REMINDER,
      payload: { scheduleId: schedule.id },
    });
  }

  const events = await claimOutboxEvents(prisma, {
    kind: OutboxEventKind.TRADIE_SCHEDULE_REMINDER,
    limit: 100,
  });
  let failed = 0;
  let processed = 0;

  for (const event of events) {
    try {
      const scheduleId = scheduleIdFromPayload(event.payload);
      if (!scheduleId) {
        await settleFailure(
          event.id,
          "The reminder payload did not contain a schedule id.",
        );
        failed += 1;
        continue;
      }

      const schedule = await prisma.tradieSchedule.findUnique({
        where: { id: scheduleId },
        include: {
          tradie: true,
          project: { include: { siteManager: true } },
          milestone: true,
        },
      });
      if (!schedule) {
        await settleFailure(
          event.id,
          "The scheduled booking no longer exists.",
        );
        failed += 1;
        continue;
      }
      if (schedule.reminderSentAt) {
        await completeOutboxEvent(prisma, event.id, {
          reason: "schedule_already_marked",
        });
        processed += 1;
        continue;
      }
      if (
        schedule.status === TradieScheduleStatus.DECLINED
        || schedule.status === TradieScheduleStatus.COMPLETED
      ) {
        await completeOutboxEvent(prisma, event.id, {
          reason: "schedule_no_longer_actionable",
        });
        processed += 1;
        continue;
      }

      if (schedule.status === TradieScheduleStatus.CONFIRMED) {
        const email = generateTradieFinalConfirmationEmail({
          id: schedule.id,
          abn: schedule.tradie.abn,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
          tradeType: schedule.tradie.trade,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          taskLabel: schedule.milestone?.name ?? "General Task",
          milestoneName: schedule.milestone?.name,
          scheduledDate: schedule.scheduledDate.toISOString(),
          durationDays: schedule.durationDays,
          status: schedule.status,
          isFavourite: schedule.tradie.isFavourite,
          note: schedule.tradie.note,
          updatedAt: schedule.updatedAt.toISOString(),
          requiresQuote: schedule.requiresQuote,
          quotedPrice: schedule.quotedPrice ?? undefined,
          contact: {
            email: schedule.tradie.email,
            phone: schedule.tradie.phone,
            additionalEmails: schedule.tradie.additionalEmails,
          },
          siteManager: {
            name: schedule.project.siteManager?.name ?? "Site manager",
            email: schedule.project.siteManager?.email ?? "",
            phone: schedule.project.siteManager?.phone ?? "",
          },
        } satisfies TradieScheduleListItem);

        await sendEmail({
          to: schedule.tradie.email,
          cc:
            schedule.tradie.additionalEmails.length > 0
              ? schedule.tradie.additionalEmails
              : undefined,
          subject: email.subject,
          body: email.html,
        });
      }

      await markTradieReminderSent(schedule.id, prisma);
      await completeOutboxEvent(prisma, event.id, {
        scheduleId: schedule.id,
      });
      processed += 1;
      console.log(
        `[REMINDER] Tradie ${schedule.tradie.name} reminded for ${schedule.project.name} on ${schedule.scheduledDate.toISOString()}`,
      );
    } catch (error) {
      failed += 1;
      await settleFailure(
        event.id,
        "The reminder provider or final schedule write failed; reconcile before retrying.",
      );
      console.error(`[REMINDER] Failed for outbox event ${event.id}:`, error);
    }
  }

  return {
    completed,
    failed,
    processed,
    skipped: window.schedules.length - window.actionable.length,
  };
}
