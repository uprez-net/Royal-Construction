"use server";

import { Prisma, TradieScheduleStatus } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import prisma from "@/lib/prisma";
import {
  SafeTradie,
  TradieCoordinationQuery,
  TradieKPIs,
  TradieScheduleWithTradieMilestoneAndProject,
} from "@/types/project";

const tradieScheduleInclude = {
  tradie: true,
  project: true,
  milestone: true,
} as const;
import { CACHE_PROFILES } from "@/types/cache";
import { getTradieCoordinationDashboard } from "./tadie-dashboard";


function toSafeTradie(tradie: Awaited<ReturnType<typeof prisma.tradie.findMany>>[number]): SafeTradie {
  return {
    ...tradie,
    hourlyRate: tradie.hourlyRate?.toString(),
    rating: tradie.rating?.toString(),
  };
}

export async function getTradies(): Promise<SafeTradie[]> {
  try {
    const tradies = await prisma.tradie.findMany({
      orderBy: { name: "asc" },
    });

    return tradies.map((tradie) => toSafeTradie(tradie));
  } catch (error) {
    console.error("Error fetching tradies:", error);
    return [];
  }
}

export async function getTradieSchedules(filters?: {
  projectId?: string;
  status?: TradieScheduleStatus;
  tradeType?: string;
  sort?: "scheduledDate" | "tradieName" | "projectName";
  order?: "asc" | "desc";
}): Promise<TradieScheduleWithTradieMilestoneAndProject[]> {
  try {
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

    return schedules.map((schedule) => ({
      ...schedule,
      tradie: {
        ...schedule.tradie,
        hourlyRate: schedule.tradie.hourlyRate?.toString(),
        rating: schedule.tradie.rating?.toString(),
      },
      project: {
        ...schedule.project,
        lotSize: schedule.project.lotSize?.toString() ?? undefined,
        totalBudget: schedule.project.totalBudget.toString(),
        spent: schedule.project.spent.toString(),
      },
      milestone: schedule.milestone ? {
        ...schedule.milestone,
        budget: schedule.milestone.budget.toString(),
        spend: schedule.milestone.spend?.toString(),
      } : undefined,
    }));
  } catch (error) {
    console.error("Error fetching tradie schedules:", error);
    return [];
  }
}

type TradieKPIResult = {
  total_scheduled: bigint;
  pending: bigint;
  pending_response: bigint;
  confirmed: bigint;
  no_response: bigint;
  declined: bigint;
  completed: bigint;
};

export async function getTradieScheduleKPIs(): Promise<TradieKPIs> {
  try {
    const [result] = await prisma.$queryRaw<TradieKPIResult[]>`
            SELECT
                COUNT(*) AS total_scheduled,

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                ) AS pending,

                COUNT(*) FILTER (
                    WHERE status = 'PENDING_RESPONSE'
                ) AS pending_response,

                COUNT(*) FILTER (
                    WHERE status = 'CONFIRMED'
                ) AS confirmed,

                COUNT(*) FILTER (
                    WHERE status = 'NO_RESPONSE'
                ) AS no_response,

                COUNT(*) FILTER (
                    WHERE status = 'DECLINED'
                ) AS declined,

                COUNT(*) FILTER (
                    WHERE status = 'COMPLETED'
                ) AS completed

            FROM "TradieSchedule"
        `;

    return {
      totalScheduled: Number(result.total_scheduled),
      pending: Number(result.pending),
      pendingResponse: Number(result.pending_response),
      confirmed: Number(result.confirmed),
      noResponse: Number(result.no_response),
      declined: Number(result.declined),
      completed: Number(result.completed),
    };
  } catch (error) {
    console.error("Error fetching tradie schedule KPIs:", error);

    return {
      totalScheduled: 0,
      pending: 0,
      pendingResponse: 0,
      confirmed: 0,
      noResponse: 0,
      declined: 0,
      completed: 0,
    };
  }
}


export async function getCachedTradies() {
  "use cache";

  cacheTag("tradies");

  cacheLife(CACHE_PROFILES.MEDIUM);

  return getTradies();
}

export async function getCachedTradieSchedules(filters?: {
  projectId?: string;
  status?: TradieScheduleStatus;
  tradeType?: string;
  sort?: "scheduledDate" | "tradieName" | "projectName";
  order?: "asc" | "desc";
}) {
  "use cache";

  cacheTag("tradies");

  cacheLife(CACHE_PROFILES.MEDIUM);

  return getTradieSchedules(filters);
}

export async function getCachedTradieScheduleKPIs() {
  "use cache";

  cacheTag("tradies-schedules");


  cacheLife(CACHE_PROFILES.MEDIUM);

  return getTradieScheduleKPIs();
}

export async function getCachedTradieCoordinationDashboard(
  query?: TradieCoordinationQuery,
) {
  "use cache";

  cacheTag("tradies-schedules");
  cacheTag("projects");

  cacheLife(CACHE_PROFILES.SHORT);

  return getTradieCoordinationDashboard(query);
}

export async function getTradiesForLookup(limit = 20, search = "") {
  try {
    const where = search
      ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { company: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { tradeType: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
      : undefined;

    const tradies = await prisma.tradie.findMany({
      where,
      take: limit,
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true, tradeType: true, phone: true, email: true },
    });

    return tradies;
  } catch (error) {
    console.error("Error fetching tradies for lookup:", error);
    return [];
  }
}