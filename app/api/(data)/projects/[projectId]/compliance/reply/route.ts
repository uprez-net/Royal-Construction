import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendCertifierReply } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { certifierReplySchema } from "@/utils/validators/compliance";

// Attachments are read back out of blob storage and base64-encoded before the
// send, which on a signed drawing set is not a fast request.
export const maxDuration = 300;

/** Sends a message on the certifier thread — the composer, and signed copies. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, certifierReplySchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { engagement } = await requireComplianceAccess(projectId);
    const result = await sendCertifierReply(engagement!.id, body.data);
    return successResponse({ projectId, ...result }, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send a certifier reply", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to send the reply.",
      { status: 400, code: "REPLY_FAILED" },
    );
  }
}
