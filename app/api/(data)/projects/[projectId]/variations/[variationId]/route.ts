import { z } from "zod";
import { domainErrorResponse } from "@/lib/http/domain-response";
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
    variationParamSchema,
  );
  if (!routeParams.success) {
    return badRequestResponse("Invalid route parameters");
  }

  const body = await parseBodyWithResponse(request, variationUpdateSchema);
  if (!body.success) {
    return badRequestResponse("Invalid request body");
  }

  const { projectId, variationId } = routeParams.data;
  try {
    const variation = await updateVariationStatus(
      projectId,
      variationId,
      body.data.status,
    );

    return successResponse(variation);
  } catch (error) {
    // A domain refusal answers with its own status and its own message.
    // "This variation was already approved." is the entire point of the guard
    // and is useless to the one person who can act on it as a bare 500 —
    // whose usual next move is to press Approve again.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error("Error updating variation status:", error);
    return errorResponse("Failed to update variation status", {
      status: 500,
      code: "VARIATION_UPDATE_FAILED",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
