import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { resolveComplianceAlert } from "@/lib/data/compliance-alerts";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { resolveComplianceAlertSchema } from "@/utils/validators/compliance";
import { z } from "zod";

const alertParamSchema = projectParamSchema.extend({
  alertId: z.string().trim().min(1, "Alert ID is required"),
});

/**
 * Closes an alert.
 *
 * Gated the same way the rest of the compliance file is rather than to admins
 * alone. Resolving one of these is not a verdict on somebody else's document —
 * it is the person chasing the surveyor recording that the replacement search
 * arrived and names the right owners. That is the same person who uploaded it.
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

  const body = await parseBodyWithResponse(
    request,
    resolveComplianceAlertSchema,
  );
  if (!body.success) return body.response;

  const { projectId, alertId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await resolveComplianceAlert({
      principal: userPrincipal(user),
      projectId,
      alertId,
      resolvedByName: user.name,
      resolutionNote: body.data.resolutionNote,
    });
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to resolve a compliance alert", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to resolve the alert.",
      { status: 400, code: "ALERT_RESOLVE_FAILED" },
    );
  }
}
