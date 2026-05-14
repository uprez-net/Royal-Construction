"use server";

import { Prisma, TradieScheduleStatus } from "@prisma/client";
import { unstable_cache } from "next/cache";

import prisma from "@/lib/prisma";
import {
  SafeTradie,
  TradieActivityItem,
  TradieCoordinationDashboard,
  TradieCoordinationQuery,
  TradieCoordinationSortBy,
  TradieCoordinationTab,
  TradieKPIs,
  TradieScheduleWithTradieMilestoneAndProject,
  TradieStatusMetric,
} from "@/types/project";

const tradieScheduleInclude = {
  tradie: true,
  project: true,
  milestone: true,
} as const;

const defaultCoordinationPageSize = 10;

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, diff));
}

function getWeekLabel(date: Date) {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short" }).format(date);
}

function normalizeSearch(search?: string | null) {
  return search?.trim() ?? "";
}

type ResolvedCoordinationQuery = {
  page: number;
  limit: number;
  search: string;
  projectId: string | null;
  tradeType: string | null;
  status: TradieScheduleStatus | null;
  tab: TradieCoordinationTab;
  sortBy: TradieCoordinationSortBy;
  sortOrder: "asc" | "desc";
};

function resolveCoordinationQuery(query?: TradieCoordinationQuery): ResolvedCoordinationQuery {
  const page = Number.isFinite(query?.page ?? 1) && (query?.page ?? 1) > 0 ? Math.floor(query?.page ?? 1) : 1;
  const limit = Number.isFinite(query?.limit ?? defaultCoordinationPageSize) && (query?.limit ?? defaultCoordinationPageSize) > 0
    ? Math.min(Math.floor(query?.limit ?? defaultCoordinationPageSize), 50)
    : defaultCoordinationPageSize;

  return {
    page,
    limit,
    search: normalizeSearch(query?.search),
    projectId: query?.projectId ?? null,
    tradeType: query?.tradeType ?? null,
    status: query?.status ?? null,
    tab: query?.tab ?? "all",
    sortBy: query?.sortBy ?? "scheduledDate",
    sortOrder: query?.sortOrder === "desc" ? "desc" : "asc",
  };
}

function buildCoordinationWhere(
  query: ResolvedCoordinationQuery,
  options?: {
    ignoreStatus?: boolean;
    ignoreTab?: boolean;
  },
): Prisma.TradieScheduleWhereInput {
  const filters: Prisma.TradieScheduleWhereInput[] = [];
  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 8);

  if (query.projectId) {
    filters.push({ projectId: query.projectId });
  }

  if (query.tradeType) {
    filters.push({ tradie: { tradeType: query.tradeType } });
  }

  if (query.search) {
    filters.push({
      OR: [
        { tradie: { name: { contains: query.search, mode: "insensitive" } } },
        { tradie: { company: { contains: query.search, mode: "insensitive" } } },
        { tradie: { tradeType: { contains: query.search, mode: "insensitive" } } },
        { project: { name: { contains: query.search, mode: "insensitive" } } },
        { milestone: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      ],
    });
  }

  if (!options?.ignoreStatus && query.status) {
    filters.push({ status: query.status });
  }

  if (!options?.ignoreTab) {
    if (query.tab === "week") {
      filters.push({ scheduledDate: { gte: today, lt: nextWeek } });
    }

    if (query.tab === "confirmed") {
      filters.push({ status: TradieScheduleStatus.CONFIRMED });
    }

    if (query.tab === "pending") {
      filters.push({
        status: {
          in: [
            TradieScheduleStatus.PENDING,
            TradieScheduleStatus.PENDING_RESPONSE,
            TradieScheduleStatus.NO_RESPONSE,
          ],
        },
      });
    }

    if (query.tab === "overdue") {
      filters.push({
        AND: [
          { scheduledDate: { lt: today } },
          { status: { notIn: [TradieScheduleStatus.COMPLETED] } },
        ],
      });
    }

    if (query.tab === "completed") {
      filters.push({ status: TradieScheduleStatus.COMPLETED });
    }
  }

  if (filters.length === 0) {
    return {};
  }

  return { AND: filters };
}

function buildOrderBy(sortBy: TradieCoordinationSortBy, sortOrder: "asc" | "desc"): Prisma.TradieScheduleOrderByWithRelationInput {
  if (sortBy === "tradieName") {
    return { tradie: { name: sortOrder } };
  }

  if (sortBy === "tradeType") {
    return { tradie: { tradeType: sortOrder } };
  }

  if (sortBy === "projectName") {
    return { project: { name: sortOrder } };
  }

  if (sortBy === "status") {
    return { status: sortOrder };
  }

  return { scheduledDate: sortOrder };
}

function mapScheduleStatus(status: TradieScheduleStatus): { type: TradieActivityItem["type"]; label: string } {
  if (status === TradieScheduleStatus.CONFIRMED || status === TradieScheduleStatus.COMPLETED) {
    return { type: "done", label: status === TradieScheduleStatus.COMPLETED ? "completed" : "confirmed" };
  }

  if (status === TradieScheduleStatus.DECLINED || status === TradieScheduleStatus.NO_RESPONSE) {
    return { type: "urgent", label: status === TradieScheduleStatus.DECLINED ? "declined" : "had no response" };
  }

  return { type: "warn", label: status === TradieScheduleStatus.PENDING_RESPONSE ? "is pending response" : "is pending" };
}

function toSafeTradie(tradie: Awaited<ReturnType<typeof prisma.tradie.findMany>>[number]): SafeTradie {
  return {
    ...tradie,
    hourlyRate: tradie.hourlyRate?.toString(),
    rating: tradie.rating?.toString(),
  };
}

export async function getTradies(): Promise<SafeTradie[]> {
  const tradies = await prisma.tradie.findMany({
    orderBy: { name: "asc" },
  });

  return tradies.map((tradie) => toSafeTradie(tradie));
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

export async function getTradieCoordinationDashboard(query?: TradieCoordinationQuery): Promise<TradieCoordinationDashboard> {
  const resolved = resolveCoordinationQuery(query);
  const listWhere = buildCoordinationWhere(resolved);
  const insightsWhere = buildCoordinationWhere(resolved, { ignoreStatus: true, ignoreTab: true });
  const orderBy = buildOrderBy(resolved.sortBy, resolved.sortOrder);

  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 8);
  const previousWeekStart = addDays(today, -7);
  const previousWeekEnd = today;

  const [
    schedules,
    totalCount,
    tradeOptionsRaw,
    totalTradies,
    currentWeekScheduled,
    previousWeekScheduled,
    pendingNoResponse,
    confirmedCount,
    completedCount,
    activeTradieRows,
    newTradiesCurrentWindow,
    newTradiesPreviousWindow,
    statusCounts,
    tabAll,
    tabWeek,
    tabConfirmed,
    tabPending,
    tabOverdue,
    tabCompleted,
    tradeStatusGroups,
    projectAllocationGroups,
    projectAllocationNames,
    utilizationRows,
    latestActivityRows,
    urgentRows,
  ] = await Promise.all([
    prisma.tradieSchedule.findMany({
      where: listWhere,
      include: {
        tradie: {
          select: {
            id: true,
            name: true,
            company: true,
            tradeType: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        milestone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy,
      skip: (resolved.page - 1) * resolved.limit,
      take: resolved.limit,
    }),
    prisma.tradieSchedule.count({ where: listWhere }),
    prisma.tradie.findMany({
      select: { tradeType: true },
      distinct: ["tradeType"],
      orderBy: { tradeType: "asc" },
    }),
    prisma.tradie.count(),
    prisma.tradieSchedule.count({
      where: {
        ...insightsWhere,
        scheduledDate: { gte: today, lt: nextWeek },
      },
    }),
    prisma.tradieSchedule.count({
      where: {
        ...insightsWhere,
        scheduledDate: { gte: previousWeekStart, lt: previousWeekEnd },
      },
    }),
    prisma.tradieSchedule.count({
      where: {
        ...insightsWhere,
        status: {
          in: [
            TradieScheduleStatus.PENDING,
            TradieScheduleStatus.PENDING_RESPONSE,
            TradieScheduleStatus.NO_RESPONSE,
          ],
        },
      },
    }),
    prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.CONFIRMED } }),
    prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.COMPLETED } }),
    prisma.tradieSchedule.findMany({
      where: {
        ...insightsWhere,
        scheduledDate: { gte: addDays(today, -14), lte: addDays(today, 14) },
        status: { notIn: [TradieScheduleStatus.DECLINED, TradieScheduleStatus.COMPLETED] },
      },
      select: { tradieId: true },
      distinct: ["tradieId"],
    }),
    prisma.tradie.count({ where: { createdAt: { gte: addDays(today, -30) } } }),
    prisma.tradie.count({ where: { createdAt: { gte: addDays(today, -60), lt: addDays(today, -30) } } }),
    Promise.all([
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.CONFIRMED } }),
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.PENDING } }),
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.PENDING_RESPONSE } }),
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.NO_RESPONSE } }),
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.DECLINED } }),
      prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.COMPLETED } }),
    ]),
    prisma.tradieSchedule.count({ where: insightsWhere }),
    prisma.tradieSchedule.count({ where: { ...insightsWhere, scheduledDate: { gte: today, lt: nextWeek } } }),
    prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.CONFIRMED } }),
    prisma.tradieSchedule.count({
      where: {
        ...insightsWhere,
        status: {
          in: [TradieScheduleStatus.PENDING, TradieScheduleStatus.PENDING_RESPONSE, TradieScheduleStatus.NO_RESPONSE],
        },
      },
    }),
    prisma.tradieSchedule.count({
      where: {
        ...insightsWhere,
        scheduledDate: { lt: today },
        status: { notIn: [TradieScheduleStatus.COMPLETED] },
      },
    }),
    prisma.tradieSchedule.count({ where: { ...insightsWhere, status: TradieScheduleStatus.COMPLETED } }),
    prisma.tradieSchedule.groupBy({
      by: ["tradieId", "status"],
      where: insightsWhere,
      _count: { _all: true },
    }),
    prisma.tradieSchedule.groupBy({
      by: ["projectId"],
      where: insightsWhere,
      _count: { _all: true },
      orderBy: { _count: { projectId: "desc" } },
      take: 6,
    }),
    prisma.project.findMany({
      where: {
        id: {
          in: [],
        },
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.tradieSchedule.findMany({
      where: {
        ...insightsWhere,
        scheduledDate: {
          gte: addDays(startOfWeek(today), -7 * 7),
          lte: addDays(startOfWeek(today), 7),
        },
      },
      select: {
        scheduledDate: true,
        status: true,
      },
    }),
    prisma.tradieSchedule.findMany({
      where: insightsWhere,
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        tradie: { select: { name: true } },
        project: { select: { name: true } },
      },
    }),
    prisma.tradieSchedule.findMany({
      where: {
        ...insightsWhere,
        scheduledDate: { gte: today, lt: nextWeek },
        status: {
          notIn: [TradieScheduleStatus.CONFIRMED, TradieScheduleStatus.COMPLETED],
        },
      },
      orderBy: { scheduledDate: "asc" },
      take: 8,
      include: {
        tradie: { select: { name: true, tradeType: true } },
        project: { select: { name: true } },
        milestone: { select: { name: true } },
      },
    }),
  ]);

  const projectIds = projectAllocationGroups.map((item) => item.projectId);
  const projectNames = projectIds.length
    ? await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    })
    : projectAllocationNames;

  const schedulesMapped = schedules.map((schedule) => ({
    id: schedule.id,
    tradieId: schedule.tradie.id,
    tradieName: schedule.tradie.name,
    company: schedule.tradie.company,
    tradeType: schedule.tradie.tradeType,
    projectId: schedule.project.id,
    projectName: schedule.project.name,
    milestoneId: schedule.milestone?.id,
    milestoneName: schedule.milestone?.name,
    taskLabel: schedule.milestone?.name ?? "General trade task",
    scheduledDate: schedule.scheduledDate.toISOString(),
    durationDays: schedule.durationDays,
    status: schedule.status,
    reminderSentAt: schedule.reminderSentAt?.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  }));

  const totalScheduledForCompletion = confirmedCount + completedCount + pendingNoResponse;
  const completionRate = totalScheduledForCompletion > 0 ? Math.round((completedCount / totalScheduledForCompletion) * 100) : 0;

  const statusMetrics: TradieStatusMetric[] = [
    { label: "Confirmed", value: statusCounts[0], status: TradieScheduleStatus.CONFIRMED },
    { label: "Pending", value: statusCounts[1], status: TradieScheduleStatus.PENDING },
    { label: "Pending Response", value: statusCounts[2], status: TradieScheduleStatus.PENDING_RESPONSE },
    { label: "No Response", value: statusCounts[3], status: TradieScheduleStatus.NO_RESPONSE },
    { label: "Declined", value: statusCounts[4], status: TradieScheduleStatus.DECLINED },
    { label: "Completed", value: statusCounts[5], status: TradieScheduleStatus.COMPLETED },
  ];

  const tradieIds = Array.from(new Set(tradeStatusGroups.map((group) => group.tradieId)));
  const tradeTypesByTradie = tradieIds.length
    ? await prisma.tradie.findMany({
      where: { id: { in: tradieIds } },
      select: { id: true, tradeType: true },
    })
    : [];

  const tradeTypeMap = new Map(tradeTypesByTradie.map((item) => [item.id, item.tradeType]));
  const tradeBreakdownMap = new Map<string, { total: number; confirmed: number }>();

  for (const group of tradeStatusGroups) {
    const tradeType = tradeTypeMap.get(group.tradieId) ?? "Unknown";
    const current = tradeBreakdownMap.get(tradeType) ?? { total: 0, confirmed: 0 };
    const count = group._count._all;
    current.total += count;

    if (group.status === TradieScheduleStatus.CONFIRMED || group.status === TradieScheduleStatus.COMPLETED) {
      current.confirmed += count;
    }

    tradeBreakdownMap.set(tradeType, current);
  }

  const tradeBreakdown = Array.from(tradeBreakdownMap.entries())
    .map(([tradeType, value]) => ({
      tradeType,
      total: value.total,
      confirmedRate: value.total > 0 ? Math.round((value.confirmed / value.total) * 100) : 0,
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 8);

  const projectNameMap = new Map(projectNames.map((project) => [project.id, project.name]));
  const projectAllocations = projectAllocationGroups.map((group) => ({
    projectId: group.projectId,
    projectName: projectNameMap.get(group.projectId) ?? "Unknown project",
    allocationCount: group._count._all,
  }));

  const trendStart = addDays(startOfWeek(today), -7 * 7);
  const trendSeries = Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(trendStart, index * 7);
    return {
      key: weekStart.toISOString(),
      weekLabel: getWeekLabel(weekStart),
      total: 0,
      confirmed: 0,
    };
  });

  const trendMap = new Map(trendSeries.map((point) => [point.key, point]));

  for (const row of utilizationRows) {
    const rowWeek = startOfWeek(row.scheduledDate).toISOString();
    const targetPoint = trendMap.get(rowWeek);

    if (!targetPoint) {
      continue;
    }

    targetPoint.total += 1;
    if (row.status === TradieScheduleStatus.CONFIRMED || row.status === TradieScheduleStatus.COMPLETED) {
      targetPoint.confirmed += 1;
    }
  }

  const utilizationTrend = trendSeries.map((point) => ({
    weekLabel: point.weekLabel,
    utilization: point.total > 0 ? Math.round((point.confirmed / point.total) * 100) : 0,
    target: 80,
  }));

  const activity = latestActivityRows.map((row) => {
    const mapped = mapScheduleStatus(row.status);
    return {
      id: row.id,
      type: mapped.type,
      message: `${row.tradie.name} ${mapped.label} for ${row.project.name}`,
      createdAt: row.updatedAt.toISOString(),
    };
  });

  const urgentReminders = urgentRows.map((row) => ({
    id: row.id,
    tradieName: row.tradie.name,
    tradeType: row.tradie.tradeType,
    projectName: row.project.name,
    taskLabel: row.milestone?.name ?? "General trade task",
    scheduledDate: row.scheduledDate.toISOString(),
    daysLeft: Math.ceil((startOfDay(row.scheduledDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    status: row.status,
  }));

  return {
    query: resolved,
    pagination: {
      page: resolved.page,
      limit: resolved.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / resolved.limit)),
    },
    schedules: schedulesMapped,
    summary: {
      registeredTradies: totalTradies,
      registeredTrendDelta: newTradiesCurrentWindow - newTradiesPreviousWindow,
      scheduledThisWeek: currentWeekScheduled,
      scheduledWeekDelta: currentWeekScheduled - previousWeekScheduled,
      confirmedBookings: confirmedCount,
      pendingNoResponse,
      activeTradies: activeTradieRows.length,
      inactiveTradies: Math.max(0, totalTradies - activeTradieRows.length),
      completionRate,
    },
    tabCounts: {
      all: tabAll,
      week: tabWeek,
      confirmed: tabConfirmed,
      pending: tabPending,
      overdue: tabOverdue,
      completed: tabCompleted,
    },
    tradeOptions: tradeOptionsRaw.map((item) => item.tradeType).filter(Boolean),
    statusMetrics,
    tradeBreakdown,
    projectAllocations,
    utilizationTrend,
    activity,
    urgentReminders,
  };
}

export const getCachedTradies = unstable_cache(
  async () => getTradies(),
  ["tradies"],
  { tags: ["tradies"], revalidate: 300 },
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
  { tags: ["tradies"], revalidate: 300 },
);

export const getCachedTradieScheduleKPIs = unstable_cache(
  async () => getTradieScheduleKPIs(),
  ["tradies-kpis"],
  { tags: ["tradies"], revalidate: 300 },
);

export const getCachedTradieCoordinationDashboard = unstable_cache(
  async (query?: TradieCoordinationQuery) => getTradieCoordinationDashboard(query),
  ["tradies-coordination"],
  { tags: ["tradies", "projects"], revalidate: 120 },
);
