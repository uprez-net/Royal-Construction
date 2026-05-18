import { auth } from '@clerk/nextjs/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { saveFile } from '@/lib/data/file';
import { getUserByClerkIdCached } from '@/lib/data/user';
import { UPLOAD_CONSTRAINTS } from '@/utils/validators/files';
import { errorResponse, unauthorizedResponse } from '@/utils/validators';

/**
 * Client payload schema - validated before token generation
 */
const clientPayloadSchema = z.object({
    fileId: z.string().optional(),
    fileName: z.string().trim().min(1, 'File name is required').max(255),
    projectId: z.string().trim().min(1, 'Project ID is required'),
    milestoneId: z.string().trim().optional().nullable(),
});

type ClientPayload = z.infer<typeof clientPayloadSchema>;

/**
 * Token payload schema - validated on completion
 */
const tokenPayloadSchema = clientPayloadSchema.extend({
    userId: z.string().min(1, 'User ID is required'),
});

type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export async function POST(request: Request): Promise<NextResponse> {
    try {
        const body = (await request.json()) as HandleUploadBody;

        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (clientPayloadStr: string) => {
                const { isAuthenticated, userId } = await auth();
                if (!isAuthenticated) {
                    throw new Error('Not authenticated');
                }

                // Parse and validate client payload
                let clientPayload: ClientPayload;
                try {
                    clientPayload = clientPayloadSchema.parse(JSON.parse(clientPayloadStr));
                } catch (error) {
                    throw new Error('Invalid file metadata in payload');
                }

                return {
                    allowedContentTypes: UPLOAD_CONSTRAINTS.allowedMimeTypes as unknown as string[],
                    addRandomSuffix: true,
                    maximumSizeInBytes: UPLOAD_CONSTRAINTS.maxFileSizeBytes,
                    tokenPayload: JSON.stringify({
                        userId,
                        projectId: clientPayload.projectId,
                        milestoneId: clientPayload.milestoneId,
                        fileId: clientPayload.fileId,
                        fileName: clientPayload.fileName,
                    } satisfies TokenPayload),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                try {
                    // Validate token payload
                    const payload = tokenPayloadSchema.parse(JSON.parse(tokenPayload!));

                    const user = await getUserByClerkIdCached(payload.userId);
                    if (!user) {
                        throw new Error('User not found');
                    }

                    await saveFile({
                        userId: user.id,
                        projectId: payload.projectId,
                        milestoneId: payload.milestoneId ?? undefined,
                        fileUrl: blob.url,
                        fileName: payload.fileName,
                    });
                } catch (error) {
                    console.error('Error in onUploadCompleted', error);
                    throw new Error('Failed to save file metadata');
                }
            },
        });

        return NextResponse.json(jsonResponse);
    } catch (error) {
        const message = (error as Error).message || 'Upload failed';
        return errorResponse(message, {
            status: 400,
            code: 'UPLOAD_ERROR',
        });
    }
}