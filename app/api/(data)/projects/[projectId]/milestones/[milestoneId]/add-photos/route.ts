import { NextRequest } from "next/server";
import {
  milestonePictureUploadSchema,
  parseBodyWithResponse,
  successResponse,
  errorResponse,
  unauthorizedResponse,
} from "@/utils/validators";
import { addPhotosToMilestone } from "@/lib/data/milestones";
import { auth } from "@clerk/nextjs/server";
import { domainErrorResponse } from "@/lib/http/domain-response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return unauthorizedResponse();
  const { projectId, milestoneId } = await params;
  const validationResult = await parseBodyWithResponse(
    request,
    milestonePictureUploadSchema,
  );
  if (!validationResult.success) {
    return validationResult.response;
  }

  const { fileIds } = validationResult.data;

  try {
    const result = await addPhotosToMilestone(
      projectId,
      milestoneId,
      fileIds as string[],
    );

    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to attach milestone photos", error);
    return errorResponse(
      "Unable to attach milestone photos. Please try again.",
      { status: 500 },
    );
  }
}
