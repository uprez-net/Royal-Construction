import { NextRequest } from "next/server";

import {
  complianceErrorResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { setEstateDeveloper } from "@/lib/data/compliance-developer";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { estateDeveloperSchema } from "@/utils/validators/compliance";

/**
 * Records whether this lot is in an estate, and who the developer is.
 *
 * The banner's own answer, and a superset of what `../requirement` takes. That
 * route stays because the development application block asks the bare yes/no in a
 * place where the address is not to hand and does not need to be; this one is the
 * banner at the top of the tab, which asks the whole question at once because it is
 * asked once at the start of the engagement and the person answering has the
 * paperwork open.
 *
 * Both answers are answers. "No" is not an absence — it is somebody saying this lot
 * carries no covenant, and it is what stops the land deed being parsed for a
 * developer on every upload for the rest of the job. Nobody having been asked is
 * the source column staying null, which this route cannot set.
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

  const body = await parseBodyWithResponse(request, estateDeveloperSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await setEstateDeveloper({
      projectId,
      required: body.data.required,
      name: body.data.name ?? null,
      // The empty string the form sends for an untouched optional email, folded to
      // null here rather than stored. A blank address on the row would read as a
      // developer we could write to.
      email: body.data.email?.trim() || null,
      phone: body.data.phone ?? null,
      recordedById: user.id,
      recordedByName: user.name,
    });
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to record the estate developer", error);
    return errorResponse(
      "Failed to record the estate developer.",
      { status: 500, code: "ESTATE_DEVELOPER_FAILED" },
    );
  }
}
