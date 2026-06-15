import prisma from "@/lib/prisma";
import { TradieScheduleStatus } from "@prisma/client";
import type { CreateTradieScheduleInput, UpdateTradieScheduleInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { createNotification } from "@/types/notification";
import { dateFormat } from "@/utils/formatters";

export async function createTradieSchedule(input: CreateTradieScheduleInput) {
  const schedule = await prisma.tradieSchedule.create({
    data: {
      tradieId: input.tradieId,
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      scheduledDate: new Date(input.scheduledDate),
      durationDays: input.durationDays ?? 1,
      status: TradieScheduleStatus.PENDING,
    },
    include: { tradie: true, project: true, milestone: true },
  });
  const siteManagerId = schedule.project.siteManagerId;
  const notificationPayload = createNotification("tradieScheduleCreated", {
    tradieName: schedule.tradie.name,
    projectName: schedule.project.name,
    milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
    projectId: schedule.projectId,
    tradieTrade: schedule.tradie.trade,
    tradieCompany: schedule.tradie.company ?? "Independent",
    scheduleDate: dateFormat.format(schedule.scheduledDate),
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

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
  const statusLabel = schedule.status.split("_").map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
  const siteManagerId = schedule.project.siteManagerId;
  const notificationPayload = createNotification("tradieScheduleUpdated", {
    tradieName: schedule.tradie.name,
    projectName: schedule.project.name,
    milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
    projectId: schedule.projectId,
    tradieTrade: schedule.tradie.trade,
    tradieCompany: schedule.tradie.company ?? "Independent",
    scheduleDate: dateFormat.format(schedule.scheduledDate),
    status: statusLabel,
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);

  return { schedule, requiresReplacement };
}
