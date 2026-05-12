import { Prisma, TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

const tradieScheduleInclude = {
  tradie: true,
  project: true,
  milestone: true,
} as const;

export type TradieScheduleWithRelations = Prisma.TradieScheduleGetPayload<{
  include: typeof tradieScheduleInclude;
}>;

export type TradieKPIs = {
  totalScheduled: number;
  pending: number;
  pendingResponse: number;
  confirmed: number;
  noResponse: number;
  declined: number;
  completed: number;
};

export async function getTradies() {
  return prisma.tradie.findMany({
    orderBy: { name: "asc" },
  });
}

export async function getTradieSchedules(filters?: {
  projectId?: string;
  status?: TradieScheduleStatus;
  tradeType?: string;
  sort?: "scheduledDate" | "tradieName" | "projectName";
  order?: "asc" | "desc";
}): Promise<TradieScheduleWithRelations[]> {
  const order = filters?.order ?? "asc";

  const orderBy =
    filters?.sort === "tradieName"
      ? { tradie: { name: order } }
      : filters?.sort === "projectName"
        ? { project: { name: order } }
        : { scheduledDate: order };

  return prisma.tradieSchedule.findMany({
    where: {
      projectId: filters?.projectId,
      status: filters?.status,
      tradie: filters?.tradeType ? { tradeType: filters.tradeType } : undefined,
    },
    include: tradieScheduleInclude,
    orderBy,
  });
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
