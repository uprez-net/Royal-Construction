import { NextRequest } from "next/server";
import { milestoneUpdateSchema, parseBodyWithResponse, successResponse } from "@/utils/validators";
import { prisma } from "@/lib/prisma";
import { SafeMilestone } from "@/types/project";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { updateMilestone } from "@/lib/data/milestones";


export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
    const { projectId, milestoneId } = await params;
    const validationResult = await parseBodyWithResponse(request, milestoneUpdateSchema);
    if (!validationResult.success) {
        return validationResult.response;
    }

    const updateData = validationResult.data;

    const updated = await updateMilestone(milestoneId, updateData);

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

    return successResponse(updated as SafeMilestone);
}