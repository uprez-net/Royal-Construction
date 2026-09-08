import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { recordPlanningCertificate } from "@/lib/data/compliance-council";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { planningCertificateSchema } from "@/utils/validators/compliance";

/**
 * Records where the 10.7(2) & (5) certificate has got to.
 *
 * One route for all three steps of the council block, because they are three
 * answers about one row and the alternative was three endpoints that must agree
 * about which of them may write which column. The step is explicit in the body;
 * see `planningCertificateSchema` for why it is not inferred from the fields.
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

  const body = await parseBodyWithResponse(request, planningCertificateSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await recordPlanningCertificate(
      projectId,
      body.data,
      user.name,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to record the planning certificate", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the planning certificate.",
      { status: 400, code: "PLANNING_CERTIFICATE_FAILED" },
    );
  }
}
