import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import {
  getCertifierEngagement,
  startCertifierEngagement,
} from "@/lib/data/compliance";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { startEngagementSchema } from "@/utils/validators/compliance";

/** The engagement for this project, or null when none has been started. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  try {
    await requireComplianceAccess(routeParams.data.projectId, {
      requireEngagement: false,
    });
    const engagement = await getCertifierEngagement(routeParams.data.projectId);
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to read the certifier engagement", error);
    return errorResponse("Failed to load the compliance file.");
  }
}

/**
 * Starts the engagement — the "Connect with Certifier" button.
 *
 * Idempotent in the data layer, so a double submission returns the engagement
 * that already exists rather than a constraint error.
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

  const body = await parseBodyWithResponse(request, startEngagementSchema);
  if (!body.success) return body.response;

  try {
    await requireComplianceAccess(routeParams.data.projectId, {
      requireEngagement: false,
    });
    const engagement = await startCertifierEngagement(
      routeParams.data.projectId,
      body.data,
    );
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to start the certifier engagement", error);
    return errorResponse("Failed to start the certifier engagement.");
  }
}
