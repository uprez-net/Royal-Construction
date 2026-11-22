import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getCachedProjectById, getProjectById } from "@/lib/data/projects";
import { projectExtractionSchema } from "@/lib/agent/projectExtraction-validators";
import { updateProject } from "@/lib/domain/projects/commands";
import { ProjectDateBlockerError } from "@/lib/domain/projects/readiness";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import {
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  notFoundResponse,
  errorResponse,
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
  // `hbcfInsurance` covers the certificate referenced from
  // `legalAdministration.hbcfInsuranceDocument`; the tender/contract bundle
  // below only ever carries the first two.
  kind: z.enum(["tender", "contract", "hbcfInsurance"]),
});

const projectValidationSchema = z.object({
  id: z.string().min(1),
  section: projectFlowSectionSchema,
  fieldPath: z.string().min(1),
  severity: z.enum(["info", "warning", "fail"]),
  message: z.string().min(1),
  ownerResponsibility: z.boolean().optional(),
  variationRequired: z.boolean().optional(),
  resolvedValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
});

const projectRequirementsPayloadSchema = projectExtractionSchema.extend({
  version: z.literal(1).optional(),
  sourceDocuments: z
    .object({
      tender: sourceDocumentSchema,
      contract: sourceDocumentSchema,
    })
    .optional(),
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
  expectedRequirementsVersion: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, updateProjectBodySchema);
  if (!body.success) return body.response;

  const projectId = routeParams.data.projectId;

  try {
    // Who may edit, whether the resulting dates are possible, and the write
    // itself are one domain command now
    // (`lib/domain/projects/commands.ts#updateProject`). This handler used to
    // carry its own `canEditProject`, its own merge of the incoming
    // requirements with the persisted ones, and a blind `project.update` with
    // no version check at all.
    const outcome = await updateProject(
      await currentPrincipal(),
      {
        council: body.data.council,
        description: body.data.description,
        estimatedEndDate: body.data.estimatedEndDate,
        expectedRequirementsVersion: body.data.expectedRequirementsVersion,
        location: body.data.location,
        name: body.data.name,
        projectId,
        requirements: body.data.requirements as
          | Record<string, unknown>
          | undefined,
        startDate: body.data.startDate,
        totalBudget: body.data.totalBudget,
      },
      prisma,
    );

    const updatedProject = await getProjectById(projectId);
    if (!updatedProject) {
      return notFoundResponse("Project");
    }

    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${updatedProject.id}`, CACHE_PROFILES.MEDIUM);

    // `data` stays the project the screens read; what the save did to the
    // start date rides beside it, so the Overview can say whether the start
    // followed the HBCF claim date or stayed because work had started.
    // The fingerprint of what this save committed, not of the re-read, which
    // may already include a later save (issue #562).
    return successResponse(
      { ...updatedProject, requirementsVersion: outcome.requirementsVersion },
      {
        meta: {
          rescheduledMilestones: outcome.rescheduledMilestones,
          startDateFollowedHbcfClaim: outcome.startDateFollowedHbcfClaim,
          startDateHeldByStartedWork: outcome.startDateHeldByStartedWork,
        },
      },
    );
  } catch (error) {
    // The blocker list is worth more to the operator than the status code:
    // the Overview tab binds each entry to the field that caused it. Kept at
    // 422 with the same `DATE_BLOCKER` code the client already handles,
    // rather than the 400 the error's own `status` would give.
    if (error instanceof ProjectDateBlockerError) {
      return errorResponse("Project date validation failed", {
        status: 422,
        code: "DATE_BLOCKER",
        issues: {
          blockers: error.blockers.map((blocker) => ({
            id: blocker.id,
            label: blocker.label,
            fieldPath: blocker.fieldPath,
            severity: blocker.severity,
          })),
        },
      });
    }

    // Every other domain refusal answers with its own status and its own
    // message. "You do not have access to update this project." is useless to
    // the one person who can act on it as an opaque INTERNAL_ERROR.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error(`PATCH /api/projects/${projectId} error`, error);
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
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  try {
    const project = await getCachedProjectById(routeParams.data.projectId);
    if (!project) {
      return notFoundResponse("Project");
    }

    return successResponse(project);
  } catch (error) {
    // A refusal (an account that may not read projects) is a 403 with its own
    // words, not a 500 that reports an incident.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    throw error;
  }
}
