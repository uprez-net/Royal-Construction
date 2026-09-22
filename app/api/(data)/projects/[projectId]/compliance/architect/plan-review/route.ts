import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { reviewArchitectPlans } from "@/lib/data/compliance-architect";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { reviewArchitectPlansSchema } from "@/utils/validators/compliance";

/**
 * Records the client's verdict on the preliminary plans.
 *
 * One route for both answers, because they are one decision. An approval opens
 * the send to the certifier; a rejection sends the client's words to the
 * architect and starts a clock on the redraw. Splitting them would leave two
 * endpoints that must never both succeed against the same set of plans.
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

  const body = await parseBodyWithResponse(request, reviewArchitectPlansSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await reviewArchitectPlans(
      projectId,
      body.data,
      user.name,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to record the client's plan review", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the client's answer.",
      { status: 400, code: "PLAN_REVIEW_FAILED" },
    );
  }
}
