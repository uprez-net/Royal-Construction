import { NextRequest } from "next/server";

import {
  complianceErrorResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { setDevelopmentApplicationRequired } from "@/lib/data/compliance-development-application";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { developmentApplicationRequirementSchema } from "@/utils/validators/compliance";

/** Records whether the compliance file needs a Development Application. */
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
    developmentApplicationRequirementSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await setDevelopmentApplicationRequired({
      projectId,
      required: body.data.required,
      answeredByName: user.name,
    });
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceErrorResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error(
      "Failed to record the Development Application requirement",
      error,
    );
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the Development Application requirement.",
      { status: 400, code: "DEVELOPMENT_APPLICATION_REQUIREMENT_FAILED" },
    );
  }
}
