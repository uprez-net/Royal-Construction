import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { setDeveloperApprovalRequired } from "@/lib/data/compliance-developer";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { developerRequirementSchema } from "@/utils/validators/compliance";

/**
 * Records whether this lot needs the estate developer's approval at all.
 *
 * The one question on the development application gate that nothing can answer
 * for itself. Whether a lot carries a bushfire covenant is on the contract of
 * sale; a title search does not say, a 10.7 does not say, and the estate list
 * says which developer to ask rather than whether asking is required. Somebody
 * who knows the job answers it, once.
 *
 * Both answers are answers. "No" is not an absence — it is somebody saying this
 * estate has no covenant, and it is what opens the gate on a job that will
 * never have a developer thread. Nobody having been asked is the column staying
 * null, which this route cannot set.
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

  const body = await parseBodyWithResponse(request, developerRequirementSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await setDeveloperApprovalRequired({
      projectId,
      required: body.data.required,
      answeredByName: user.name,
    });
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to record the developer approval requirement", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the developer approval requirement.",
      { status: 400, code: "DEVELOPER_REQUIREMENT_FAILED" },
    );
  }
}
