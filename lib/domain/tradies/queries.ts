import { Role, type Prisma, type TradieScheduleStatus } from "@prisma/client";

import { canManageProject } from "../access/projects";
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
import {
  tradeFilterLabels,
  tradeLabelsMatching,
  tradeSearchTerms,
} from "./trade-types";

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
  // Eve types trades freely, in the office's words; the list's spelling is
  // what `trades` matches.
  const tradeFilter = input.trade?.trim()
    ? await tradeFilterLabels(input.trade, db)
    : null;
  const tradeLabels = query ? await tradeLabelsMatching(query, db) : [];
  const tradeTerms = tradeSearchTerms(query);
  return db.tradie.findMany({
    where: {
      archivedAt: null,
      isFavourite: input.favouriteOnly ? true : undefined,
      AND: [
        // Any of their categories: a plumber who also does gas is a gasfitter.
        tradeFilter === null
          ? {}
          : tradeFilter.length === 0
            ? tradieInTradeWhere(input.trade as string)
            : tradeFilter.length === 1
              ? tradieInTradeWhere(tradeFilter[0]!)
              : { OR: tradeFilter.map(tradieInTradeWhere) },
        query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                ...tradeTerms.map((term) => ({
                  trade: { contains: term, mode: "insensitive" as const },
                })),
                ...(tradeLabels.length > 0
                  ? [{ trades: { hasSome: tradeLabels } }]
                  : []),
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

export type TradieActivityItem = {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly scheduleId: string | null;
  /**
   * Null for an entry about the tradie rather than a job, and when the caller
   * may not manage that project: they still see what happened, not whose
   * build it was — the same rule `listTradieBookings` follows.
   */
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly milestoneName: string | null;
  /** Who did it; null for the system. */
  readonly authorName: string | null;
};

export type TradieActivityPage = {
  readonly items: readonly TradieActivityItem[];
  /** Pass back to read the next, older page; null when there is none. */
  readonly nextCursor: string | null;
};

const ACTIVITY_PAGE_SIZE = 25;

/**
 * A tradie's activity log, newest first, a page at a time. Staff.
 *
 * Read fresh rather than through the tradie page's cache: the commands that
 * write it run from Eve, the email webhook and a cron, none of which can
 * expire that cache.
 */
export async function listTradieActivity(
  principal: DomainPrincipal,
  input: {
    readonly tradieId: string;
    readonly cursor?: string | null;
    readonly limit?: number;
  },
  db: DomainDb,
): Promise<TradieActivityPage> {
  assertCanReadTradieDirectory(principal);
  const limit = Math.min(Math.max(input.limit ?? ACTIVITY_PAGE_SIZE, 1), 100);
  const rows = await db.tradieActivityLog.findMany({
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      author: { select: { name: true } },
      createdAt: true,
      id: true,
      message: true,
      milestone: { select: { name: true } },
      project: { select: { id: true, name: true, siteManagerId: true } },
      scheduleId: true,
      type: true,
    },
    take: limit + 1,
    where: { tradieId: input.tradieId },
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => {
      const visible = row.project
        ? canManageProject(principal, row.project)
        : false;
      return {
        authorName: row.author?.name ?? null,
        createdAt: row.createdAt,
        id: row.id,
        message: row.message,
        milestoneName: visible ? (row.milestone?.name ?? null) : null,
        project:
          visible && row.project
            ? { id: row.project.id, name: row.project.name }
            : null,
        scheduleId: row.scheduleId,
        type: row.type,
      };
    }),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
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
