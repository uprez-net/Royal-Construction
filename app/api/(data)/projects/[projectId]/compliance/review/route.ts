import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceMutation,
} from "@/lib/compliance/access";
import { sendComplianceForReview } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

export const maxDuration = 300;

/**
 * Sends the completed checklist to the certifier for review.
 *
 * The same route serves the first send and every re-send after a round of
 * rejections — from the certifier's point of view they are the same message on
 * the same thread, and from ours the only difference is which documents happen
 * to be approved already.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId } = routeParams.data;

  try {
    const { engagement } = await requireComplianceMutation(projectId);
    const result = await sendComplianceForReview(engagement!.id);
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send the compliance file for review", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the file to the certifier.",
      { status: 400, code: "REVIEW_SEND_FAILED" },
    );
  }
}
