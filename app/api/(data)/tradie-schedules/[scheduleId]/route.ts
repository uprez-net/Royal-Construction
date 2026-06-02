import { z } from "zod";

import { updateTradieSchedule } from "@/lib/data/tradieSchedules";
import {
  updateTradieScheduleSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";

const ScheduleParamSchema = z.object({
  scheduleId: z.string().trim().min(1, "Schedule ID is required"),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    { scheduleId: resolvedParams.scheduleId },
    ScheduleParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, updateTradieScheduleSchema);
  if (!body.success) return body.response;

  const result = await updateTradieSchedule(routeParams.data.scheduleId, { status: body.data.status });

  return successResponse(result);
}
