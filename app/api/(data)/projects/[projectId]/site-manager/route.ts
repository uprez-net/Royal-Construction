import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getProjectById } from "@/lib/data/projects";
import { assignProjectSiteManager } from "@/lib/domain/projects/commands";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  notFoundResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

const assignSiteManagerBodySchema = z.object({
  siteManagerId: z.string().trim().min(1, "Pick a site manager"),
});

/**
 * Reassign the project's site manager from the project header.
 *
 * Answers with the refreshed project detail, the same shape the project PATCH
 * returns, so the header can put it straight back into the store.
 */
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
    assignSiteManagerBodySchema,
  );
  if (!body.success) return body.response;

  const projectId = routeParams.data.projectId;

  try {
    const outcome = await assignProjectSiteManager(
      await currentPrincipal(),
      { projectId, siteManagerId: body.data.siteManagerId },
      prisma,
    );

    if (outcome.changed) {
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
    }

    const updatedProject = await getProjectById(projectId);
    if (!updatedProject) return notFoundResponse("Project");

    return successResponse(updatedProject);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(`PATCH /api/projects/${projectId}/site-manager error`, error);
    return errorResponse("Failed to change the site manager", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
