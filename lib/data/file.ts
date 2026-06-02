"use server";

import prisma from '@/lib/prisma';

interface SaveFileParams {
    userId: string;
    projectId?: string;
    milestoneId?: string;
    fileId?: string;
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    leadId?: string;
}

export async function saveFile({ userId, projectId, milestoneId, fileId, fileUrl, fileName, fileType, fileSize, leadId }: SaveFileParams) {
    try {
        const newFile = await prisma.file.create({
            data: {
                id: fileId,
                uploadedBy: userId,
                projectId,
                milestoneId,
                url: fileUrl,
                filename: fileName,
                fileType,
                filesize: fileSize,
                leadId: leadId ? parseInt(leadId) : null,
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

export async function getFilesByLeadId(leadId: number) {
    try {
        const files = await prisma.file.findMany({
            where: {
                leadId,
            },
        });

        return {
            success: true,
            count: files.length,
            files,
        }
    }
    catch (error) {
        console.error('Error fetching files for lead', error);
        throw error;
    }
}