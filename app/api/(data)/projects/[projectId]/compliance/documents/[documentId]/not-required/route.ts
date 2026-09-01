import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAdmin,
} from "@/lib/compliance/access";
import { setComplianceDocumentNotRequired } from "@/lib/data/compliance";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import {
  complianceDocumentParamSchema,
  setComplianceDocumentNotRequiredSchema,
} from "@/utils/validators/compliance";

/**
 * Marks one checklist line as not applying to this job, or puts it back.
 *
 * ADMIN-only, the same gate the approve/reject decision carries. It is the same
 * kind of judgement: it settles a row without a document behind it, and it is
 * what lets the engagement close, so it must not be available to the person
 * being asked to supply the documents.
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
    setComplianceDocumentNotRequiredSchema,
  );
  if (!body.success) return body.response;

  const { projectId, documentId } = routeParams.data;

  // The id in the path is the one that is acted on, as it is on the resolve
  // route beside this. A body naming a different document is a mismatch worth
  // refusing rather than silently preferring one.
  if (body.data.documentId !== documentId) {
    return errorResponse("The document in the body does not match the path.", {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  try {
    const admin = await requireComplianceAdmin(projectId);

    const result = await setComplianceDocumentNotRequired({
      projectId,
      documentId,
      notRequired: body.data.notRequired,
      resolvedBy: admin.name || admin.email,
    });

    // `changed: false` is not an error. Two admins agreeing, or a double click,
    // lands on the state that was asked for — which is success.
    return successResponse({ projectId, documentId, status: result.status });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to set a compliance document as not required", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to update the document.",
    );
  }
}
