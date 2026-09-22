import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendPartyReply } from "@/lib/data/compliance-outreach";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { partyReplySchema } from "@/utils/validators/compliance";

/**
 * Sends a message on one party's thread.
 *
 * The certifier has its own route beside this one rather than sharing it. The
 * two look alike but are not the same act: a certifier reply threads off the
 * engagement's own `lastInboundMessageId` and can move the engagement's status,
 * while this one names the outreach it belongs to and never touches the
 * certifier flow.
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

  const body = await parseBodyWithResponse(request, partyReplySchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;
  const { outreachId, ...input } = body.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await sendPartyReply(
      userPrincipal(user),
      projectId,
      outreachId,
      input,
      request.headers.get("idempotency-key") ?? undefined,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send a compliance party reply", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to send the message.",
      { status: 400, code: "PARTY_REPLY_FAILED" },
    );
  }
}
