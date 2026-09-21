import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { classifyReceivedDocument } from "@/lib/data/compliance";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import {
  classifyReceivedDocumentSchema,
  complianceDocumentParamSchema,
} from "@/utils/validators/compliance";

/**
 * Labels a received document the classifier could not identify.
 *
 * The model is deliberately unwilling to guess between a fee proposal and an
 * invoice, which is right — but it leaves documents sitting as UNKNOWN, and the
 * response blocks key on type. This is the way back.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    complianceDocumentParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(
    request,
    classifyReceivedDocumentSchema,
  );
  if (!body.success) return body.response;

  const { projectId, documentId } = routeParams.data;

  try {
    await requireComplianceAccess(projectId);
    const result = await classifyReceivedDocument({
      projectId,
      documentId,
      documentType: body.data.documentType,
    });
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to identify a compliance document", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to identify the document.",
      { status: 400, code: "CLASSIFY_FAILED" },
    );
  }
}
