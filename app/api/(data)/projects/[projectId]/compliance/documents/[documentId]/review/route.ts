import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendComplianceDocumentForReview } from "@/lib/data/compliance";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import { complianceDocumentParamSchema } from "@/utils/validators/compliance";

export const maxDuration = 300;

/** Sends one collected checklist item for asynchronous certifier review. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    complianceDocumentParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId, documentId } = routeParams.data;
  try {
    const { engagement } = await requireComplianceAccess(projectId);
    const result = await sendComplianceDocumentForReview(
      engagement!.id,
      documentId,
    );
    return successResponse({ projectId, documentId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to send a compliance document for review", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the document for verification.",
      { status: 400, code: "DOCUMENT_REVIEW_SEND_FAILED" },
    );
  }
}
