import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { requestUpdatedTitleSearch } from "@/lib/data/compliance-outreach";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { z } from "zod";

const alertParamSchema = projectParamSchema.extend({
  alertId: z.string().trim().min(1, "Alert ID is required"),
});

/**
 * Asks the surveyor for a fresh title search.
 *
 * Its own route rather than a flag on the resolve, because it is the opposite
 * act: resolving says the condition is answered, and this says we have asked.
 * The alert stays open either way until a replacement lands and the owner check
 * passes.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; alertId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    alertParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId, alertId } = routeParams.data;

  try {
    await requireComplianceAccess(projectId);
    const engagement = await requestUpdatedTitleSearch(projectId, alertId);
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to request an updated title search", error);
    // The data layer refuses with the reason — no surveyor engaged, alert
    // already closed — so it reaches the user as the message that explains it.
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the request to the surveyor.",
      { status: 400, code: "TITLE_SEARCH_REQUEST_FAILED" },
    );
  }
}
