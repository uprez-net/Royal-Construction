import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendComplianceFollowUp } from "@/lib/data/compliance-follow-up";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { z } from "zod";

const alertParamSchema = projectParamSchema.extend({
  alertId: z.string().trim().min(1, "Alert ID is required"),
});

/**
 * Chases whoever an open alert is waiting on.
 *
 * Replaces `request-update`, which did the same thing for the one alert type
 * that existed when it was written. Six overdue conditions later the choice was
 * six near-identical endpoints or one that knows which party each alert is
 * about; the data layer holds that table.
 *
 * Its own route rather than a flag on the resolve, because it is the opposite
 * act: resolving says the condition is answered, and this says we have asked.
 * The alert stays open either way, until the thing it is waiting for arrives.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; alertId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    alertParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId, alertId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await sendComplianceFollowUp(
      projectId,
      alertId,
      userPrincipal(user),
      user.name,
      request.headers.get("idempotency-key") ?? undefined,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send a compliance follow-up", error);
    // The data layer refuses with the reason — nobody engaged, alert already
    // closed, no thread behind this condition — so it reaches the user as the
    // message that actually explains it.
    return errorResponse(
      error instanceof Error ? error.message : "Failed to send the follow-up.",
      { status: 400, code: "FOLLOW_UP_FAILED" },
    );
  }
}
