import { createVariation } from "@/lib/data/variations";
import {
  createVariationSchema,
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
} from "@/utils/validators";
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

  return successResponse(variation, { status: 201 });
}
