import { z } from "zod";
import { updateVariationStatus } from "@/lib/data/variations";
import {
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  badRequestResponse,
  errorResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";

const variationUpdateSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

const variationParamSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required"),
  variationId: z.string().trim().min(1, "Variation ID is required"),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; variationId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    variationParamSchema
  );
  if (!routeParams.success) {
    return badRequestResponse("Invalid route parameters");
  };

  const body = await parseBodyWithResponse(request, variationUpdateSchema);
  if (!body.success) {
    return badRequestResponse("Invalid request body");
  }

  const { variationId } = routeParams.data;
  try {
    const variation = await updateVariationStatus(variationId, body.data.status);

    return successResponse(variation);
  } catch (error) {
    console.error("Error updating variation status:", error);
    return errorResponse("Failed to update variation status", {
      status: 500,
      code: "VARIATION_UPDATE_FAILED",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
