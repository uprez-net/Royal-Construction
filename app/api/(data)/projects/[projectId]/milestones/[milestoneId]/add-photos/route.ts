import { NextRequest } from "next/server";
import { milestonePictureUploadSchema, parseBodyWithResponse, successResponse } from "@/utils/validators";
import { addPhotosToMilestone } from "@/lib/data/milestones";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
    const { projectId, milestoneId } = await params;
    const validationResult = await parseBodyWithResponse(request, milestonePictureUploadSchema);
    if (!validationResult.success) {
        return validationResult.response;
    }

    const { fileIds } = validationResult.data;

    const result = await addPhotosToMilestone(projectId, milestoneId, fileIds as string[]);

    return successResponse(result);
}