import prisma from "@/lib/prisma";
import { parseBodyWithResponse, parseRouteParamsWithResponse, successResponse } from "@/utils/validators";
import { projectParamSchema } from "@/utils/validators/projects";
import { NextRequest } from "next/server";
import { milestoneCreationSchema } from "@/utils/validators";
import { Prisma } from "@prisma/client";
import { MilestoneWithFilesTradiesUpdates } from "@/types/project";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { getMilestonesByProject, createMilestone } from "@/lib/data/milestones";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const milestones = await getMilestonesByProject(routeParams.data.projectId);

  return successResponse(milestones);
}


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const milestoneCreationResult = await parseBodyWithResponse(request, milestoneCreationSchema);

  if (!milestoneCreationResult.success) return milestoneCreationResult.response;

  const creationData = milestoneCreationResult.data;
  const newMilestone = await createMilestone(projectId, creationData);

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return successResponse(newMilestone as MilestoneWithFilesTradiesUpdates);
}