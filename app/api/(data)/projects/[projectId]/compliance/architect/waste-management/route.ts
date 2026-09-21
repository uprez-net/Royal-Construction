import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { requestWasteManagementPlan } from "@/lib/data/compliance-architect";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { wasteManagementRequestSchema } from "@/utils/validators/compliance";

/**
 * Asks the architect for the waste management plan.
 *
 * Under `architect/` rather than under `parties/`, because nobody is being
 * engaged: the plan is drawn against the design this architect already
 * produced, on the thread they have been on since the plans were commissioned.
 * A route under `parties/` would read as opening a second engagement, and the
 * unique index on [engagementId, party] would then refuse it.
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

  const body = await parseBodyWithResponse(
    request,
    wasteManagementRequestSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await requestWasteManagementPlan(
      projectId,
      body.data,
      user.name,
    );
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to request the waste management plan", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to request the waste management plan.",
      { status: 400, code: "WASTE_MANAGEMENT_REQUEST_FAILED" },
    );
  }
}
