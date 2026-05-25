import prisma from "@/lib/prisma";
import { parseBodyWithResponse, parseRouteParamsWithResponse, successResponse } from "@/utils/validators";
import { projectParamSchema } from "@/utils/validators/projects";
import { NextRequest } from "next/server";
import { milestoneCreationSchema } from "@/utils/validators";
import { Prisma } from "@prisma/client";
import { MilestoneWithFilesTradiesUpdates } from "@/types/project";

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

  const milestones = await prisma.milestone.findMany({
    where: { projectId: routeParams.data.projectId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isPhotoRequired: true,
      status: true,
      order: true,
    },
  });

  return successResponse(milestones);
}


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const milestoneCreationResult = await parseBodyWithResponse(
    request,
    milestoneCreationSchema
  );

  if (!milestoneCreationResult.success) {
    return milestoneCreationResult.response;
  }

  const creationData = milestoneCreationResult.data;
  const newMilestone = await prisma.milestone.create({
    data: {
      name: creationData.name,
      order: await prisma.milestone.count({ where: { projectId } }) + 1,
      description: creationData.description,
      targetDate: new Date(creationData.targetDate),
      budget: new Prisma.Decimal(creationData.budget),
      projectId,
      parentId: creationData.parentId,
    }
  });

  return successResponse({
    ...newMilestone,
    budget: newMilestone.budget.toString(),
    spend: newMilestone.spend?.toString(),
    files: [],
    siteUpdates: [],
    tradieSchedules: [],
  } as MilestoneWithFilesTradiesUpdates);
}