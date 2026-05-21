import { VariationStatus } from "@prisma/client";

import { getProjectById } from "@/lib/data/projects";
import prisma from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import {
  createVariationSchema,
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, createVariationSchema);
  if (!body.success) return body.response;

  const projectId = routeParams.data.projectId;

  await prisma.variation.create({
    data: {
      projectId: projectId,
      description: body.data.description,
      cost: body.data.cost,
      requestedDate: body.data.requestedDate || new Date(),
      status: VariationStatus.PENDING,
    },
  });

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  const updatedProject = await getProjectById(projectId);

  if (!updatedProject) {
    return errorResponse("Project not found after creating variation", {
      status: 404,
      code: "NOT_FOUND",
    });
  }

  return successResponse(updatedProject, { status: 201 });
}
