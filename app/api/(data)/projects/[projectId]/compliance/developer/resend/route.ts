import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceMutation,
} from "@/lib/compliance/access";
import { resendDeveloperApproval } from "@/lib/data/compliance-developer";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { developerResendSchema } from "@/utils/validators/compliance";

/**
 * Puts the bushfire report back in front of the developer.
 *
 * The other half of a rejection loop, and deliberately a click rather than
 * something that happens on its own when the revised report lands. Everything
 * else that leaves this system for a third party is a click for the same
 * reason: the person sending it is the person who has looked at what came back.
 * A revised report that answers a different objection — or that came back
 * unchanged, which happens — would otherwise go straight out under our name and
 * buy a second refusal a fortnight later.
 *
 * Under `developer/` rather than `parties/`, like the architect's own extra
 * verbs: nobody is being engaged here. The outreach exists, the thread is
 * running, and this is a message on it.
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

  const body = await parseBodyWithResponse(request, developerResendSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceMutation(projectId);
    const engagement = await resendDeveloperApproval({
      projectId,
      documentType: body.data.documentType,
      note: body.data.note ?? null,
      extraAttachmentIds: body.data.extraAttachmentIds,
      requestedByName: user.name,
    });
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to send the report back to the developer", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the report back to the developer.",
      { status: 400, code: "DEVELOPER_RESEND_FAILED" },
    );
  }
}
