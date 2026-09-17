import "server-only";

import prisma from '@/lib/prisma';
import { createActivityLogEntry } from '@/types/activityLog';
import { CACHE_PROFILES } from '@/types/cache';
import { revalidateTag } from 'next/cache';
import { after } from 'next/server'
import { logAction } from './actionLog';

interface SaveFileParams {
    userId: string;
    projectId?: string;
    milestoneId?: string;
    leadId?: string;
    fileId?: string;
    fileUrl: string;
    storagePath?: string;
    fileName: string;
    fileType: string;
    fileSize: number;
}

/**
 * Saves a file record to the database.
 *
 * Files may be associated with:
 * - A project
 * - A milestone
 * - A lead
 *
 * After the file has been successfully saved, this function schedules
 * post-response tasks to:
 * - Revalidate the associated project cache.
 * - Revalidate the lead chat session cache when applicable.
 * - Create an activity log entry for project or milestone uploads.
 *
 * Authorizes nobody. `userId` must be a User.id the caller derived itself (the
 * session's user, or a system actor), and the caller must already have checked
 * the lead, project or milestone the row names. /api/upload and the MCP
 * upload_file tool check them; archiveLeadAttachments is a system caller.
 *
 * @param params - File metadata and association information.
 * @param params.userId - ID of the user uploading the file.
 * @param params.projectId - Optional project the file belongs to.
 * @param params.milestoneId - Optional milestone the file belongs to.
 * @param params.leadId - Optional lead the file belongs to.
 * @param params.fileId - Optional custom file identifier.
 * @param params.fileUrl - Storage URL of the uploaded file.
 * @param params.fileName - Original file name.
 * @param params.fileType - MIME type or file category.
 * @param params.fileSize - File size in bytes.
 *
 * @returns An object containing the saved file and operation status.
 *
 * @throws Re-throws any database errors encountered while saving the file.
 */
export async function saveFile({ userId, projectId, milestoneId, fileId, fileUrl, storagePath, fileName, fileType, fileSize, leadId }: SaveFileParams) {
    try {
        const newFile = await prisma.file.create({
            data: {
                id: fileId,
                uploadedBy: userId,
                projectId,
                milestoneId,
                url: fileUrl,
                storagePath,
                filename: fileName,
                fileType,
                filesize: fileSize,
                leadId: leadId ? parseInt(leadId) : null,
            }
        });

        after(async () => {
            if (projectId || milestoneId) {
                revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
                const activityEntryLog = createActivityLogEntry('fileUploaded', {
                    projectId: projectId!,
                    milestoneId: milestoneId,
                    fileId: newFile.id,
                    fileName: newFile.filename,
                    fileType: newFile.fileType,
                    fileSize: newFile.filesize,
                });
                await logAction(activityEntryLog);
            }
            if (leadId) {
                revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);
            }
        })

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

/**
 * Retrieves all files associated with a lead.
 *
 * This helper is primarily used for lead conversations and document
 * management, returning every uploaded file linked to the specified lead.
 *
 * Authorizes nobody, and nothing calls it today: a caller must check the lead
 * with assertCanAccessLead first.
 *
 * @param leadId - Lead identifier.
 * @returns An object containing the matching files, total file count and
 * operation status.
 *
 * @throws Re-throws any database errors encountered during retrieval.
 */
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
