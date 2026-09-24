import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { attachComplianceDocumentFile } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { complianceDocumentUploadSchema } from "@/utils/validators/compliance";

/**
 * Attaches an uploaded file to a compliance document.
 *
 * The blob and its File row already exist — the client uploads straight to
 * Vercel Blob and /api/upload writes the row — so this only links the two and
 * moves the document on. Either `documentId` (a seeded or extracted row) or
 * `documentType` (the signed copies and home insurance, which have no row until
 * one is uploaded) identifies the target.
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

  const body = await parseBodyWithResponse(
    request,
    complianceDocumentUploadSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { engagement } = await requireComplianceAccess(projectId);

    const document = await attachComplianceDocumentFile({
      engagementId: engagement!.id,
      projectId,
      documentId: body.data.documentId,
      documentType: body.data.documentType,
      fileId: body.data.fileId,
    });

    return successResponse({ projectId, document }, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to attach a compliance document", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to attach the uploaded file.",
    );
  }
}
