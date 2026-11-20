import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceMutation,
} from "@/lib/compliance/access";
import { sendComplianceDocumentsForReview } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { earlyReviewSendSchema } from "@/utils/validators/compliance";

export const maxDuration = 300;

/**
 * Sends the checklist rows the office ticked to the certifier, in one email,
 * without waiting for the rest of the checklist.
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
  const body = await parseBodyWithResponse(request, earlyReviewSendSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;
  try {
    const { engagement } = await requireComplianceMutation(projectId);
    const result = await sendComplianceDocumentsForReview(
      engagement!.id,
      body.data.documentIds,
    );
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send checklist documents for review", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the documents for verification.",
      { status: 400, code: "DOCUMENT_REVIEW_SEND_FAILED" },
    );
  }
}
