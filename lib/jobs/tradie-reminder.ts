import { addDays, endOfDay, startOfDay } from "date-fns";
import { TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function sendTradieReminders(): Promise<{ processed: number; skipped: number }> {
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
      project: true,
    },
  });

  const actionable = schedules.filter((schedule) => schedule.reminderSentAt === null);
  const skipped = schedules.length - actionable.length;

  await prisma.$transaction(async (tx) => {
    for (const schedule of actionable) {
      await tx.tradieSchedule.update({
        where: { id: schedule.id },
        data: {
          reminderSentAt: new Date(),
          status:
            schedule.status === TradieScheduleStatus.PENDING
              ? TradieScheduleStatus.PENDING_RESPONSE
              : schedule.status,
        },
      });

      console.log(
        `[REMINDER] Tradie ${schedule.tradie.name} reminded for ${schedule.project.name} on ${schedule.scheduledDate.toISOString()}`,
      );
    }
  });

  return { processed: actionable.length, skipped };
}
