import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { getCachedProjectById, getProjectById } from "@/lib/data/projects";
import { projectExtractionSchema } from "@/lib/agent/projectExtraction-validators";
import { CACHE_PROFILES } from "@/types/cache";
import { Role } from "@prisma/client";
import { revalidateTag } from "next/cache";
import {
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  errorResponse
} from "@/utils/validators";
import { z } from "zod";

const projectFlowSectionSchema = z.enum([
  "legalAdministration",
  "commercialsAndClaims",
  "subStructureAndGround",
  "inclusionsAndExclusions",
  "utilityInfrastructure",
  "wetAreaCompliance",
  "safetyAndSiteLogistics",
  "general",
]);

const sourceDocumentSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  url: z.string().url(),
  kind: z.enum(["tender", "contract"]),
});

const projectValidationSchema = z.object({
  id: z.string().min(1),
  section: projectFlowSectionSchema,
  fieldPath: z.string().min(1),
  severity: z.enum(["info", "warning", "fail"]),
  message: z.string().min(1),
  ownerResponsibility: z.boolean().optional(),
  variationRequired: z.boolean().optional(),
  resolvedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const projectRequirementsPayloadSchema = projectExtractionSchema.extend({
  version: z.literal(1).optional(),
  sourceDocuments: z.object({
    tender: sourceDocumentSchema,
    contract: sourceDocumentSchema,
  }).optional(),
  validations: z.array(projectValidationSchema).optional(),
});

const updateProjectBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  council: z.string().trim().optional(),
  description: z.string().trim().nullable().optional(),
  startDate: z.string().optional(),
  estimatedEndDate: z.string().optional(),
  totalBudget: z.number().optional(),
  requirements: projectRequirementsPayloadSchema.optional(),
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
    const existingProject = await prisma.project.findUnique({
      where: { id: routeParams.data.projectId },
      select: {
        id: true,
        customerId: true,
        siteManagerId: true,
        Lead: {
          select: {
            assignedId: true,
          },
        },
      },
    });

    if (!existingProject) {
      return notFoundResponse("Project");
    }

    const canEditProject =
      user.role === Role.ADMIN ||
      existingProject.siteManagerId === user.id ||
      existingProject.Lead.assignedId === user.id ||
      (user.role === Role.CUSTOMER && user.customerId === existingProject.customerId);

    if (!canEditProject) {
      return forbiddenResponse("You do not have access to update this project.");
    }

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

    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${updatedProject.id}`, CACHE_PROFILES.MEDIUM);

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
