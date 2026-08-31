import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAdmin,
} from "@/lib/compliance/access";
import { resolveComplianceDocument } from "@/lib/data/compliance";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import {
  complianceDocumentParamSchema,
  resolveComplianceDocumentSchema,
} from "@/utils/validators/compliance";

/**
 * Approves or rejects one compliance document.
 *
 * One route for both decisions rather than a pair, because they are the same
 * act with a different answer and share every guard: ADMIN only, the same
 * status precondition, and the same audit entry shape.
 *
 * ADMIN-only, the same gate resolving a tradie approval carries. This is the
 * decision that freezes a document or sends it back, and it must not be
 * available to the person who uploaded it.
 */
export async function POST(
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
    resolveComplianceDocumentSchema,
  );
  if (!body.success) return body.response;

  const { projectId, documentId } = routeParams.data;

  // The id in the path is the one that is acted on. A body naming a different
  // document is a mismatch worth refusing rather than silently preferring one.
  if (body.data.documentId !== documentId) {
    return errorResponse("The document in the body does not match the path.", {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  try {
    const admin = await requireComplianceAdmin(projectId);

    const result = await resolveComplianceDocument({
      projectId,
      documentId,
      decision: body.data.decision,
      rejectionReason: body.data.rejectionReason,
      resolvedBy: admin.name || admin.email,
    });

    if (!result.resolved) {
      // Someone else decided it first, or this tab is stale. A 409 with the
      // current status lets the client re-render rather than showing an error
      // for what is really "already done".
      return errorResponse("This document has already been resolved.", {
        status: 409,
        code: "ALREADY_RESOLVED",
        details: `Current status: ${result.status}`,
      });
    }

    return successResponse({ projectId, documentId, status: result.status });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to resolve a compliance document", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to resolve the document.",
    );
  }
}
