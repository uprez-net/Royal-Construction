import { TradieScheduleStatus } from "@prisma/client";
import { getCachedTradieCoordinationDashboard, getCachedTradies } from "@/lib/data/tradies";
import prisma from "@/lib/prisma";
import {
  createTradieScheduleSchema,
  tradieCoordinationListQuerySchema,
  parseBodyWithResponse,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";

export async function POST(request: Request) {
  const body = await parseBodyWithResponse(request, createTradieScheduleSchema);
  if (!body.success) return body.response;

  const data = body.data;

  const schedule = await prisma.tradieSchedule.create({
    data: {
      tradieId: data.tradieId,
      projectId: data.projectId,
      milestoneId: data.milestoneId || null,
      scheduledDate: data.scheduledDate,
      durationDays: data.durationDays ?? 1,
      status: TradieScheduleStatus.PENDING,
    },
    include: {
      tradie: true,
      project: true,
      milestone: true,
    },
  });

  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
  return successResponse(schedule, { status: 201 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "coordination") {
    const params = parseSearchParamsWithResponse(url, tradieCoordinationListQuerySchema);
    if (!params.success) return params.response;

    const payload = await getCachedTradieCoordinationDashboard(params.data);
    return successResponse(payload);
  }

  const tradies = await getCachedTradies();
  return successResponse(tradies);
}
