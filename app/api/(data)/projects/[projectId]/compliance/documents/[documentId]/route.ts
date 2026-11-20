import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
  requireComplianceAdmin,
} from "@/lib/compliance/access";
import {
  classifyReceivedDocument,
  dismissReceivedDocument,
} from "@/lib/data/compliance";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
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
    const { user } = await requireComplianceAccess(projectId);
    const result = await classifyReceivedDocument({
      principal: userPrincipal(user),
      projectId,
      documentId,
      documentType: body.data.documentType,
    });
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to identify a compliance document", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to identify the document.",
      { status: 400, code: "CLASSIFY_FAILED" },
    );
  }
}

/**
 * Dismisses a received document nobody could identify because it is not part
 * of the job — a signature logo, a flyer. Deletes the row and the stored file
 * for good, so it is ADMIN-only like the other decisions that settle a row.
 */
export async function DELETE(
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
    const admin = await requireComplianceAdmin(projectId);
    const result = await dismissReceivedDocument({
      principal: userPrincipal(admin),
      projectId,
      documentId,
      dismissedBy: admin.name || admin.email,
    });
    return successResponse({
      projectId,
      documentId: result.documentId,
      reclaimed: result.reclaimed,
    });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to dismiss a compliance document", error);
    return errorResponse("Failed to dismiss the document.", {
      status: 500,
      code: "DISMISS_FAILED",
    });
  }
}
