import { VariationStatus } from "@prisma/client";

import { getProjectById } from "@/lib/data/projects";
import prisma from "@/lib/prisma";
import { createVariation } from "@/lib/data/variations";
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
import { SafeVariation } from "@/types/project";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
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

  const variation = await createVariation(projectId, body.data);

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return successResponse(variation, { status: 201 });
}
