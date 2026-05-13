"use server";

import { TradieScheduleStatus } from "@prisma/client";
import { unstable_cache } from "next/cache";

import prisma from "@/lib/prisma";
import { SafeTradie, TradieKPIs, TradieScheduleWithTradieMilestoneAndProject } from "@/types/project";

const tradieScheduleInclude = {
  tradie: true,
  project: true,
  milestone: true,
} as const;

export async function getTradies(): Promise<SafeTradie[]> {
  const tradies = await prisma.tradie.findMany({
    orderBy: { name: "asc" },
  });
  return tradies.map(tradie => ({
    ...tradie,
    hourlyRate: tradie.hourlyRate?.toString(),
    rating: tradie.rating?.toString(),
  }));
}

export async function getTradieSchedules(filters?: {
  projectId?: string;
  status?: TradieScheduleStatus;
  tradeType?: string;
  sort?: "scheduledDate" | "tradieName" | "projectName";
  order?: "asc" | "desc";
}): Promise<TradieScheduleWithTradieMilestoneAndProject[]> {
  const order = filters?.order ?? "asc";

  const orderBy =
    filters?.sort === "tradieName"
      ? { tradie: { name: order } }
      : filters?.sort === "projectName"
        ? { project: { name: order } }
        : { scheduledDate: order };

  const schedules = await prisma.tradieSchedule.findMany({
    where: {
      projectId: filters?.projectId,
      status: filters?.status,
      tradie: filters?.tradeType ? { tradeType: filters.tradeType } : undefined,
    },
    include: tradieScheduleInclude,
    orderBy,
  });

  return schedules.map(schedule => ({
    ...schedule,
    tradie: {
      ...schedule.tradie,
      hourlyRate: schedule.tradie.hourlyRate?.toString(),
      rating: schedule.tradie.rating?.toString(),
    },
    project: {
      ...schedule.project,
      totalBudget: schedule.project.totalBudget.toString(),
      spent: schedule.project.spent.toString(),
    },
    // normalize nullable milestone (Prisma may return null) to undefined to match our TS type
    milestone: schedule.milestone ?? undefined,
  }));
}

export async function getTradieScheduleKPIs(): Promise<TradieKPIs> {
  const [totalScheduled, pending, pendingResponse, confirmed, noResponse, declined, completed] = await Promise.all([
    prisma.tradieSchedule.count(),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.PENDING } }),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.PENDING_RESPONSE } }),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.CONFIRMED } }),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.NO_RESPONSE } }),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.DECLINED } }),
    prisma.tradieSchedule.count({ where: { status: TradieScheduleStatus.COMPLETED } }),
  ]);

  return { totalScheduled, pending, pendingResponse, confirmed, noResponse, declined, completed };
}

export const getCachedTradies = unstable_cache(
  async () => getTradies(),
  ["tradies"],
  { tags: ["tradies"], revalidate: false },
);

export const getCachedTradieSchedules = unstable_cache(
  async (filters?: {
    projectId?: string;
    status?: TradieScheduleStatus;
    tradeType?: string;
    sort?: "scheduledDate" | "tradieName" | "projectName";
    order?: "asc" | "desc";
  }) => getTradieSchedules(filters),
  ["tradie-schedules"],
  { tags: ["tradies"], revalidate: false },
);

export const getCachedTradieScheduleKPIs = unstable_cache(
  async () => getTradieScheduleKPIs(),
  ["tradies-kpis"],
  { tags: ["tradies"], revalidate: false },
);
