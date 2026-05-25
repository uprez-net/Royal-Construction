import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { milestonePictureUploadSchema, parseBodyWithResponse, successResponse } from "@/utils/validators";

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

    return successResponse({ id: milestoneId, projectId, files: addedFiles });
}