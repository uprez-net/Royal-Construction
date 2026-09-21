import { addDays, endOfDay, startOfDay } from "date-fns";
import { TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/azureClient";
import { generateTradieFinalConfirmationEmail } from "@/utils/generate-email";
import type { TradieScheduleListItem } from "@/types/project";

export async function sendTradieReminders(): Promise<{
  processed: number;
  skipped: number;
  failed: number;
}> {
  const targetDate = addDays(startOfDay(new Date()), 7);
  const windowStart = startOfDay(targetDate);
  const windowEnd = endOfDay(targetDate);

  const schedules = await prisma.tradieSchedule.findMany({
    where: {
      scheduledDate: {
        gte: windowStart,
        lte: windowEnd,
      },
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
      schedule.status !== TradieScheduleStatus.DECLINED &&
      schedule.status !== TradieScheduleStatus.COMPLETED,
  );
  const skipped = schedules.length - actionable.length;
  let failed = 0;

  for (const schedule of actionable) {
    try {
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

      await prisma.tradieSchedule.update({
        where: { id: schedule.id },
        data: {
          reminderSentAt: new Date(),
          status:
            schedule.status === TradieScheduleStatus.CONFIRMED
              ? TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
              : schedule.status === TradieScheduleStatus.PENDING
                ? TradieScheduleStatus.PENDING_RESPONSE
                : schedule.status,
        },
      });
      console.log(
        `[REMINDER] Tradie ${schedule.tradie.name} reminded for ${schedule.project.name} on ${schedule.scheduledDate.toISOString()}`,
      );
    } catch (error) {
      failed += 1;
      console.error(`[REMINDER] Failed for schedule ${schedule.id}:`, error);
    }
  }

  return { processed: actionable.length - failed, skipped, failed };
}
