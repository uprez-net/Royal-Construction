import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import { projectParamSchema } from "@/utils/validators/projects";
import { NextRequest } from "next/server";
import { milestoneCreationSchema } from "@/utils/validators";
import { MilestoneWithFilesTradiesUpdates } from "@/types/project";
import { getMilestonesByProject, createMilestone } from "@/lib/data/milestones";
import { domainErrorResponse } from "@/lib/http/domain-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  try {
    const milestones = await getMilestonesByProject(routeParams.data.projectId);
    return successResponse(milestones);
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Milestone list failed", error);
    return errorResponse("Could not load the activities.", { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const milestoneCreationResult = await parseBodyWithResponse(
    request,
    milestoneCreationSchema,
  );

  if (!milestoneCreationResult.success) return milestoneCreationResult.response;

  try {
    const newMilestone = await createMilestone(
      projectId,
      milestoneCreationResult.data,
    );
    return successResponse(newMilestone as MilestoneWithFilesTradiesUpdates);
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Milestone create failed", error);
    return errorResponse("Could not add the activity.", { status: 500 });
  }
}
