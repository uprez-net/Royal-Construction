import prisma from "@/lib/prisma";
import { TradieScheduleStatus } from "@prisma/client";
import type { CreateTradieScheduleInput, UpdateTradieScheduleInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";

export async function createTradieSchedule(input: CreateTradieScheduleInput) {
  const schedule = await prisma.tradieSchedule.create({
    data: {
      tradieId: input.tradieId,
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      scheduledDate: input.scheduledDate,
      durationDays: input.durationDays ?? 1,
      status: TradieScheduleStatus.PENDING,
    },
    include: { tradie: true, project: true, milestone: true },
  });
  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
  
  return schedule;
}

export async function updateTradieSchedule(scheduleId: string, updates: UpdateTradieScheduleInput) {
  const schedule = await prisma.tradieSchedule.update({
    where: { id: scheduleId },
    data: { status: updates.status },
    include: { tradie: true, project: true, milestone: true },
  });

  const requiresReplacement = updates.status === TradieScheduleStatus.DECLINED;

  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);

  return { schedule, requiresReplacement };
}
