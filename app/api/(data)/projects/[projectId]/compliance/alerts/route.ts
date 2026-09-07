import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { raiseComplianceAlert } from "@/lib/data/compliance-alerts";
import { getCertifierEngagement } from "@/lib/data/compliance";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { raiseComplianceAlertSchema } from "@/utils/validators/compliance";

/**
 * Raises a compliance alert by hand.
 *
 * The same two conditions are raised automatically off an inbound message, and
 * this exists because that path depends on the extraction being right: the case
 * that matters most is the one it read past. An admin looking at the reply
 * itself has to be able to say what it means.
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

  const body = await parseBodyWithResponse(request, raiseComplianceAlertSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { engagement } = await requireComplianceAccess(projectId);
    await raiseComplianceAlert({
      projectId,
      engagementId: engagement!.id,
      type: body.data.type,
      raisedByParty: body.data.raisedByParty ?? null,
      detail: body.data.detail ?? null,
    });
    return successResponse(await getCertifierEngagement(projectId), {
      status: 201,
    });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to raise a compliance alert", error);
    return errorResponse("Failed to raise the alert.", {
      status: 400,
      code: "ALERT_FAILED",
    });
  }
}
