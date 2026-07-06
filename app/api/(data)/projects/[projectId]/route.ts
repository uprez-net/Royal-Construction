import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { getCachedProjectById } from "@/lib/data/projects";
import { getProjectById } from "@/lib/data/projects";
import {
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  errorResponse
} from "@/utils/validators";
import { z } from "zod";

const updateProjectBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  council: z.string().trim().optional(),
  description: z.string().trim().nullable().optional(),
  startDate: z.string().optional(),
  estimatedEndDate: z.string().optional(),
  totalBudget: z.number().optional(),
  requirements: z.unknown().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorizedResponse();
  }

  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return unauthorizedResponse();
  }

  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(resolvedParams, projectParamSchema);
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, updateProjectBodySchema);
  if (!body.success) return body.response;

  try {
    const project = await prisma.project.update({
      where: { id: routeParams.data.projectId },
      data: {
        ...(body.data.name ? { name: body.data.name } : {}),
        ...(body.data.location ? { location: body.data.location } : {}),
        ...(body.data.council !== undefined ? { council: body.data.council } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description } : {}),
        ...(body.data.startDate ? { startDate: new Date(body.data.startDate) } : {}),
        ...(body.data.estimatedEndDate ? { estimatedEndDate: new Date(body.data.estimatedEndDate) } : {}),
        ...(body.data.totalBudget !== undefined ? { totalBudget: String(body.data.totalBudget) } : {}),
        ...(body.data.requirements !== undefined ? { requirements: body.data.requirements as never } : {}),
      },
    });

    const updatedProject = await getProjectById(project.id);
    if (!updatedProject) {
      return notFoundResponse("Project");
    }

    return successResponse(updatedProject);
  } catch (error) {
    console.error(`PATCH /api/projects/${routeParams.data.projectId} error`, error);
    return errorResponse("Failed to update project", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const project = await getCachedProjectById(routeParams.data.projectId);
  if (!project) {
    return notFoundResponse("Project");
  }

  return successResponse(project);
}
