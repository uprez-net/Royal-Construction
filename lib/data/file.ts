"use server";

import prisma from '@/lib/prisma';

interface SaveFileParams {
    userId: string;
    projectId: string;
    milestoneId?: string;
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
}

export async function saveFile({ userId, projectId, milestoneId, fileUrl, fileName, fileType, fileSize }: SaveFileParams) {
    try {
        const newFile = await prisma.file.create({
            data: {
                uploadedBy: userId,
                projectId,
                milestoneId,
                url: fileUrl,
                filename: fileName,
                fileType,
                filesize: fileSize
            }
        });

        return {
            success: true,
            file: newFile,
            message: 'File saved successfully',
        }
    } catch (error) {
        console.error('Error saving file to database', error);
        throw error;
    }

}