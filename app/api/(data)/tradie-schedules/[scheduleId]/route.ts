import { TradieScheduleStatus } from "@prisma/client";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  updateTradieScheduleSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
} from "@/utils/validators";

const ScheduleParamSchema = z.object({
  scheduleId: z.string().trim().min(1, "Schedule ID is required"),
});

export async function PATCH(
  request: Request,
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

  const requiresReplacement = body.data.status === TradieScheduleStatus.DECLINED;

  const schedule = await prisma.tradieSchedule.update({
    where: { id: routeParams.data.scheduleId },
    data: {
      status: body.data.status,
    },
    include: {
      tradie: true,
      project: true,
      milestone: true,
    },
  });

  return successResponse({
    schedule,
    requiresReplacement,
  });
}
