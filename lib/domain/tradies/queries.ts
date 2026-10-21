import { Role, type Prisma, type TradieScheduleStatus } from "@prisma/client";

import {
  assertCanReadTradieDirectory,
  authorizeTradie,
  authorizeTradieSchedule,
  tradieScheduleListScope,
} from "../access/tradies";
import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import {
  isUserPrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { INACTIVE_SCHEDULE_STATUSES, requireActiveTradie } from "./lifecycle";
import { tradieInTradeWhere } from "./request-rules";

/** Read fresh at request/review time, including overdue unfinished bookings. */
export async function getTradieRemovalImpact(
  principal: DomainPrincipal,
  tradieId: string,
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  await requireActiveTradie(tradieId, db);
  const schedules = await db.tradieSchedule.findMany({
    where: { tradieId, status: { notIn: INACTIVE_SCHEDULE_STATUSES } },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      durationDays: true,
      project: { select: { id: true, name: true } },
      milestone: { select: { name: true } },
    },
  });
  return {
    schedules: schedules.map((schedule) => ({
      ...schedule,
      scheduledDate: schedule.scheduledDate.toISOString(),
    })),
  };
}

export async function searchTradies(
  principal: DomainPrincipal,
  input: {
    query: string;
    trade?: string;
    favouriteOnly: boolean;
    limit: number;
  },
  db: DomainDb,
) {
  assertCanReadTradieDirectory(principal);
  const query = input.query.trim();
  return db.tradie.findMany({
    where: {
      archivedAt: null,
      isFavourite: input.favouriteOnly ? true : undefined,
      AND: [
        // Any of their categories: a plumber who also does gas is a gasfitter.
        input.trade ? tradieInTradeWhere(input.trade) : {},
        query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { trade: { contains: query, mode: "insensitive" as const } },
                { trades: { has: query } },
                { abn: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ isFavourite: "desc" }, { name: "asc" }],
    take: input.limit,
    select: {
      id: true,
      name: true,
      trade: true,
      trades: true,
      abn: true,
      email: true,
      phone: true,
      isFavourite: true,
      lastQuotedPrice: true,
      lastQuotedPriceUnit: true,
      rating: true,
      note: true,
    },
  });
}

export async function getTradieDetail(
  principal: DomainPrincipal,
  tradieId: string,
  db: DomainDb,
) {
  await authorizeTradie(principal, tradieId, db);
  const details = await db.tradie.findUnique({
    where: { id: tradieId },
    include: {
      ratings: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { user: { select: { name: true } } },
      },
      incidents:
        isUserPrincipal(principal) && principal.role === Role.ADMIN
          ? { orderBy: { createdAt: "desc" as const }, take: 25 }
          : false,
      schedules: {
        where: tradieScheduleListScope(principal),
        orderBy: { scheduledDate: "desc" },
        take: 50,
        include: {
          project: { select: { id: true, name: true } },
          milestone: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!details) throw new DomainNotFoundError("Tradie not found");
  return details;
}

export type TradieScheduleQuery = {
  readonly tradieId?: string;
  readonly projectId?: string;
  readonly status?: TradieScheduleStatus;
  readonly query: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
};

export async function listTradieSchedules(
  principal: DomainPrincipal,
  input: TradieScheduleQuery,
  db: DomainDb,
) {
  assertCanReadTradieDirectory(principal);
  const where: Prisma.TradieScheduleWhereInput = {
    tradieId: input.tradieId,
    projectId: input.projectId,
    status: input.status,
    ...tradieScheduleListScope(principal),
    ...(input.from || input.to
      ? {
          scheduledDate: {
            gte: input.from ? new Date(input.from) : undefined,
            lt: input.to ? new Date(input.to) : undefined,
          },
        }
      : {}),
    ...(input.query
      ? {
          OR: [
            {
              tradie: { name: { contains: input.query, mode: "insensitive" } },
            },
            {
              tradie: { trade: { contains: input.query, mode: "insensitive" } },
            },
            {
              project: { name: { contains: input.query, mode: "insensitive" } },
            },
            {
              milestone: {
                name: { contains: input.query, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };
  return db.tradieSchedule.findMany({
    where,
    orderBy: { scheduledDate: "asc" },
    take: input.limit,
    include: {
      tradie: { select: { id: true, name: true, trade: true, email: true } },
      project: { select: { id: true, name: true, siteManagerId: true } },
      milestone: { select: { id: true, name: true } },
    },
  });
}

export async function getTradieScheduleDetail(
  principal: DomainPrincipal,
  scheduleId: string,
  db: DomainDb,
) {
  await authorizeTradieSchedule(principal, scheduleId, db);
  const schedule = await db.tradieSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      tradie: true,
      project: { select: { id: true, name: true, siteManagerId: true } },
      milestone: true,
    },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found");
  return schedule;
}

export async function getCreatedScheduleSummary(
  principal: DomainPrincipal,
  scheduleId: string,
  db: DomainDb,
) {
  await authorizeTradieSchedule(principal, scheduleId, db);
  const schedule = await db.tradieSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      tradie: { select: { id: true, name: true, trade: true } },
      project: { select: { id: true, name: true } },
    },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found");
  return schedule;
}
