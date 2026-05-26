import { TradieScheduleStatus } from "@prisma/client";
import { getCachedTradieCoordinationDashboard, getCachedTradies } from "@/lib/data/tradies";
import { createTradieSchedule } from "@/lib/data/tradieSchedules";
import {
  createTradieScheduleSchema,
  tradieCoordinationListQuerySchema,
  parseBodyWithResponse,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await parseBodyWithResponse(request, createTradieScheduleSchema);
  if (!body.success) return body.response;

  const data = body.data;
  const schedule = await createTradieSchedule(data);

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
