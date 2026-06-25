'use server';
import prisma from "@/lib/prisma";
import { TradieSchedule, TradieScheduleStatus, Tradie, Project, User, Milestone } from "@prisma/client";
import type { CreateTradieScheduleInput, UpdateTradieScheduleInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { createNotification } from "@/types/notification";
import { dateFormat } from "@/utils/formatters";
import { after } from "next/server"
import { TradieScheduleListItem } from "@/types/project";

interface TradieScheduleWithRelations extends TradieSchedule {
  tradie: Tradie;
  project: Project & { siteManager: User | null };
  milestone: Milestone | null;
}


const convertToTradieScheduleListItem = (schedule: TradieScheduleWithRelations): TradieScheduleListItem => {
  const coverted = {
    id: schedule.id,
    abn: schedule.tradie.abn,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
    tradeType: schedule.tradie.trade,
    projectId: schedule.projectId,
    projectName: schedule.project.name,
    taskLabel: schedule.milestone ? schedule.milestone.name : "General Task",
    scheduledDate: dateFormat.format(schedule.scheduledDate),
    durationDays: schedule.durationDays,
    status: schedule.status,
    isFavourite: schedule.tradie.isFavourite,
    note: schedule.tradie.note,
    updatedAt: dateFormat.format(schedule.updatedAt),
    requiresQuote: schedule.requiresQuote,
    quotedPrice: schedule.quotedPrice ?? undefined,
    contact: {
      email: schedule.tradie.email,
      phone: schedule.tradie.phone
    },
    siteManager: {
      name: schedule.project.siteManager?.name || "",
      email: schedule.project.siteManager?.email || "",
      phone: schedule.project.siteManager?.phone || ""
    }
  } satisfies TradieScheduleListItem;

  return coverted;
}

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
    include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
  });
  const siteManagerId = schedule.project.siteManagerId;
  const notificationPayload = createNotification("tradieScheduleCreated", {
    tradieName: schedule.tradie.name,
    projectName: schedule.project.name,
    milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
    projectId: schedule.projectId,
    tradieTrade: schedule.tradie.trade,
    scheduleDate: dateFormat.format(schedule.scheduledDate),
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);

  return convertToTradieScheduleListItem(schedule);
}

export async function bulkCreateTradieSchedules(inputs: CreateTradieScheduleInput[]) {
  const schedules = await prisma.tradieSchedule.createManyAndReturn({
    data: inputs.map(input => ({
      tradieId: input.tradieId,
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      scheduledDate: new Date(input.scheduledDate),
      durationDays: input.durationDays ?? 1,
      status: TradieScheduleStatus.PENDING,
      requiresQuote: input.requiresQuote ?? false,
    })),
    include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
  });

  after(async () => {
    const projectIds = Array.from(new Set(schedules.map(schedule => schedule.projectId)));
    revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    for (const projectId of projectIds) {
      revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
    }
    for (const schedule of schedules) {
      if (schedule.project.siteManagerId) {
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification("tradieScheduleCreated", {
          tradieName: schedule.tradie.name,
          projectName: schedule.project.name,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          projectId: schedule.projectId,
          tradieTrade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
        });
        await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
      }
    }
  });

  return schedules.map(convertToTradieScheduleListItem);
}

export async function updateTradieSchedule(scheduleId: string, updates: UpdateTradieScheduleInput) {
  const schedule = await prisma.tradieSchedule.update({
    where: { id: scheduleId },
    data: { status: updates.status },
    include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
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
    scheduleDate: dateFormat.format(schedule.scheduledDate),
    status: statusLabel,
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);

  return { schedule: convertToTradieScheduleListItem(schedule), requiresReplacement };
}