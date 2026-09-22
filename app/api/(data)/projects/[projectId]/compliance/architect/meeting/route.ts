import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import {
  resolveClientMeeting,
  scheduleClientMeeting,
} from "@/lib/data/compliance-architect";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import {
  resolveComplianceMeetingSchema,
  scheduleComplianceMeetingSchema,
} from "@/utils/validators/compliance";

/**
 * Books the client and architect meeting.
 *
 * POST opens one, PATCH says what became of it. Two verbs on one path rather
 * than two paths, because there is only ever one live meeting on a file and
 * these are the two things that can be done to it — and a PATCH that has to
 * find the meeting itself cannot be pointed at a stale one by a tab that has
 * been open since the last reschedule.
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
    scheduleComplianceMeetingSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await scheduleClientMeeting(
      projectId,
      body.data,
      user.name,
    );
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to schedule the client meeting", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to schedule the meeting.",
      { status: 400, code: "MEETING_FAILED" },
    );
  }
}

export async function PATCH(
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
    resolveComplianceMeetingSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const { user } = await requireComplianceAccess(projectId);
    const engagement = await resolveClientMeeting(
      projectId,
      body.data,
      user.name,
    );
    return successResponse(engagement);
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to resolve the client meeting", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update the meeting.",
      { status: 400, code: "MEETING_FAILED" },
    );
  }
}
