import { NextRequest } from "next/server";
import {
  milestoneUpdateSchema,
  parseBodyWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { updateMilestone } from "@/lib/data/milestones";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
  const { milestoneId } = await params;
  const validationResult = await parseBodyWithResponse(
    request,
    milestoneUpdateSchema,
  );
  if (!validationResult.success) {
    return validationResult.response;
  }

  const updateData = validationResult.data;

  try {
    return successResponse(await updateMilestone(milestoneId, updateData));
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Milestone update failed", error);
    return errorResponse("Could not update the activity. Try again.", {
      status: 500,
    });
  }
}
