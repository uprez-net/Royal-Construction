import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { recordExternalApplication } from "@/lib/data/compliance-applications";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { externalApplicationSchema } from "@/utils/validators/compliance";

/**
 * Records where an application to an outside body has got to.
 *
 * One route for all three steps and all five kinds — the 10.7 certificate, the
 * road opening permit, the long service levy, the mine subsidence approval and
 * the development application — because they are answers about one row and the
 * alternative was fifteen endpoints that must agree about which of them may
 * write which column. Both the step and the kind are explicit in the body; see
 * `externalApplicationSchema` for why the step is not inferred from the fields.
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

  const body = await parseBodyWithResponse(request, externalApplicationSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await recordExternalApplication(
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
    console.error("Failed to record the application", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the application.",
      { status: 400, code: "EXTERNAL_APPLICATION_FAILED" },
    );
  }
}
