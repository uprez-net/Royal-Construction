import { NextRequest } from "next/server";

import {
  complianceErrorResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { recordPrincipalCertifier } from "@/lib/data/compliance-applications";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { principalCertifierSchema } from "@/utils/validators/compliance";

/**
 * Records that the certifier has been appointed principal certifier.
 *
 * Its own route rather than a step on `../applications`, because it is a fact
 * about the engagement rather than about a lodgement: one appointment per job,
 * not one per application, so a job that has to relodge a CDC appoints nobody a
 * second time. Folding it into the application union would have meant a `kind`
 * on a payload that has nothing to do with any one kind.
 *
 * Takes the user's id rather than their name, unlike the application route
 * beside it. That route writes a sentence into the activity trail and a name is
 * what a sentence wants; this writes a foreign key as well, because the
 * appointment names a person the portal holds us to and the account behind it has
 * to be resolvable afterwards.
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

  const body = await parseBodyWithResponse(request, principalCertifierSchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await recordPrincipalCertifier(
      projectId,
      body.data,
      user.id,
      user.name,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceErrorResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to record the principal certifier", error);
    return errorResponse(
      "Failed to record the principal certifier appointment.",
      { status: 500, code: "PRINCIPAL_CERTIFIER_FAILED" },
    );
  }
}
