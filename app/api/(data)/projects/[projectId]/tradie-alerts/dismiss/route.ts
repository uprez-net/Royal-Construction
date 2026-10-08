import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { dismissTradieScheduleAlerts } from "@/lib/domain/tradies/alerts";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

const dismissTradieAlertsSchema = z.object({
  scheduleIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

/**
 * Dismiss the tradie follow-up alerts on some of a project's bookings.
 *
 * Each stays dismissed until its booking changes status
 * (`lib/domain/tradies/alerts.ts`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, dismissTradieAlertsSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const result = await dismissTradieScheduleAlerts(
      await currentPrincipal(),
      { projectId, scheduleIds: body.data.scheduleIds },
      prisma,
    );

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      `POST /api/projects/${projectId}/tradie-alerts/dismiss`,
      error,
    );
    return errorResponse("Failed to dismiss the alerts.", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
