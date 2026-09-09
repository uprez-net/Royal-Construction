import { ComplianceApprovalChannel } from "@prisma/client";
import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { recordDeveloperDecision } from "@/lib/data/compliance-developer";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { developerDecisionSchema } from "@/utils/validators/compliance";

/**
 * Records the estate developer's answer on the bushfire report.
 *
 * The manual half of a decision the inbound workflow also makes on its own. An
 * admin reads the developer's reply and presses Approve or Reject; the workflow
 * reads the same reply with a model and calls the same function. Both are
 * needed and neither is redundant: the parse handles the ordinary case with
 * nobody watching, and the button handles the developer who rings up, or
 * answers on a thread the correlation missed, or writes something the
 * extraction would not stake a job on.
 *
 * `channel: ADMIN` is what makes the two safe together. It is the flag that
 * stops a later automated pass over the same message undoing a person who had
 * read it properly — see `recordDeveloperDecision`, which is where that
 * asymmetry lives.
 *
 * A rejection sends itself on. The data layer opens the revision round with the
 * bushfire consultant and mails them the developer's words, because a file that
 * has recorded a refusal and not passed it on is a fortnight of nobody doing
 * anything, and the words are already in hand.
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

  const body = await parseBodyWithResponse(request, developerDecisionSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await recordDeveloperDecision({
      projectId,
      decision: body.data.decision,
      reason: body.data.reason ?? null,
      channel: ComplianceApprovalChannel.ADMIN,
      decidedById: user.id,
      decidedByName: user.name,
    });
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to record the developer's decision", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the developer's decision.",
      { status: 400, code: "DEVELOPER_DECISION_FAILED" },
    );
  }
}
