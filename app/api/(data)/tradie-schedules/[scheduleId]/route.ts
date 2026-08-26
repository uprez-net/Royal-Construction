import { z } from "zod";

import { requestTradieScheduleDeletion, updateTradieSchedule } from "@/lib/data/tradieSchedules";
import {
  deleteTradieScheduleSchema,
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

/**
 * Raises an admin approval request to remove the schedule.
 *
 * The booking is NOT deleted here. A reason is required because an admin has
 * to judge the request, and the row only disappears once they approve it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    { scheduleId: resolvedParams.scheduleId },
    ScheduleParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, deleteTradieScheduleSchema);
  if (!body.success) return body.response;

  const result = await requestTradieScheduleDeletion({
    scheduleId: routeParams.data.scheduleId,
    reason: body.data.reason,
  });

  return successResponse(result);
}
