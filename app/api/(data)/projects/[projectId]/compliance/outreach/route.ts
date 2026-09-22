import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendCertifierOutreach } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

// Reading a full document pack back out of blob storage and pushing it through
// Graph's chunked upload session is well past the default budget.
export const maxDuration = 300;

/**
 * Sends the required document pack to the certifier.
 *
 * `sendCertifierOutreach` refuses on a missing document and lets Graph's own
 * size assertion through, so both failures reach the user as the message that
 * actually explains them rather than a generic 500.
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
    const { engagement } = await requireComplianceAccess(projectId);
    const result = await sendCertifierOutreach(engagement!.id);
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send certifier outreach", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the documents to the certifier.",
      { status: 400, code: "OUTREACH_FAILED" },
    );
  }
}
