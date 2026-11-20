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
import { tradieInTradeWhere } from "@/lib/domain/tradies/request-rules";
import {
  canonicalTradeLabel,
  tradeLabelsMatching,
} from "@/lib/domain/tradies/trade-types";
import { getTradieCoordinationDashboard } from "./tradie-dashboard";
import { ProjectRequirementsPayload } from "@/types/project-flow";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { assertCanReadTradieDirectory } from "@/lib/domain/access/tradies";
import { DomainAuthorizationError } from "@/lib/domain/errors";

function toSafeTradie(
  tradie: Awaited<ReturnType<typeof prisma.tradie.findMany>>[number],
): SafeTradie {
  return {
    ...tradie,
    lastQuotedPrice: tradie.lastQuotedPrice?.toString(),
    rating: tradie.rating?.toString(),
  };
}

export async function getTradies(): Promise<SafeTradie[]> {
  try {
    const tradies = await prisma.tradie.findMany({
      where: { archivedAt: null },
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
        tradie: filters?.tradeType ? { trade: filters.tradeType } : undefined,
      },
      include: tradieScheduleInclude,
      orderBy,
    });

    return schedules.map((schedule) => ({
      ...schedule,
      tradie: {
        ...schedule.tradie,
        lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString(),
        rating: schedule.tradie.rating?.toString(),
      },
      project: {
        ...schedule.project,
        requirements: schedule.project
          .requirements as unknown as ProjectRequirementsPayload,
        lotSize: schedule.project.lotSize?.toString() ?? undefined,
        totalBudget: schedule.project.totalBudget.toString(),
        spent: schedule.project.spent.toString(),
      },
      milestone: schedule.milestone
        ? {
            ...schedule.milestone,
            budget: schedule.milestone.budget.toString(),
            spend: schedule.milestone.spend?.toString(),
          }
        : undefined,
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
                    WHERE status IN ('PENDING_RESPONSE', 'PENDING_FINAL_CONFIRMATION')
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

export async function getTradiesForLookup(limit = 20, search = "", trade = "") {
  // A Server Action: any signed-in client can call it, so the directory rule
  // is checked here. It sits before the `try` below, which answers `[]` for
  // any error, so a refusal reaches the caller as a refusal and not an empty
  // list.
  const principal = await signedInUserPrincipal();
  if (!principal)
    throw new DomainAuthorizationError("Sign in to browse tradies.");
  assertCanReadTradieDirectory(principal);
  try {
    const tradeLabels = search ? await tradeLabelsMatching(search, prisma) : [];
    const search_: Prisma.TradieWhereInput | undefined = search
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { abn: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { trade: { contains: search, mode: Prisma.QueryMode.insensitive } },
            ...(tradeLabels.length > 0
              ? [{ trades: { hasSome: tradeLabels } }]
              : []),
          ],
        }
      : undefined;

    // ANDed with the search rather than replacing it, so a compliance picker
    // can narrow to surveyors and still let the user type a name. Any of the
    // tradie's categories counts: a firm that surveys among other things is
    // still a surveyor.
    const where: Prisma.TradieWhereInput | undefined = trade
      ? {
          AND: [
            search_ ?? {},
            tradieInTradeWhere(await canonicalTradeLabel(trade, prisma)),
          ],
        }
      : search_;

    const tradies = await prisma.tradie.findMany({
      where: { ...where, archivedAt: null },
      take: limit,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        abn: true,
        phone: true,
        email: true,
        trade: true,
        // The picker offers these alongside the primary address: a firm's job
        // inbox is routinely not the address on their directory row.
        additionalEmails: true,
      },
    });

    return tradies;
  } catch (error) {
    console.error("Error fetching tradies for lookup:", error);
    return [];
  }
}
