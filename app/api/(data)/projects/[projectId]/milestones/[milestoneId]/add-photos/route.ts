import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { milestonePictureUploadSchema, parseBodyWithResponse, successResponse } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";

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

    await prisma.milestone.update({
        where: {
            id: milestoneId,
        },
        data: {
            files: {
                connect: fileIds.map((fileId: string) => ({ id: fileId })),
            },
        }
    });

    const addedFiles = await prisma.file.findMany({
        where: {
            id: { in: fileIds },
        },
    });

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

    return successResponse({ id: milestoneId, projectId, files: addedFiles });
}