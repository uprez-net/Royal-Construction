import { auth } from '@clerk/nextjs/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { saveFile } from '@/lib/data/file';
import { getUserByClerkIdCached } from '@/lib/data/user';
import { ClientPayload, clientPayloadSchema, TokenPayload, tokenPayloadSchema, UPLOAD_CONSTRAINTS } from '@/utils/validators';
import { errorResponse, unauthorizedResponse } from '@/utils/validators';

export async function POST(request: Request): Promise<NextResponse> {
    try {
        const body = (await request.json()) as HandleUploadBody;

        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (pathname: string, clientPayloadStr: string | null) => {
                const { isAuthenticated, userId } = await auth();
                if (!isAuthenticated) {
                    throw new Error('Unauthorized');
                }

                // Parse and validate client payload
                let clientPayload: ClientPayload;
                try {
                    if (!clientPayloadStr) {
                        throw new Error('Client payload is required');
                    }
                    const parsedPayload = JSON.parse(clientPayloadStr);
                    clientPayload = clientPayloadSchema.parse(parsedPayload);
                } catch (error) {
                    console.error('Invalid client payload', error);
                    throw new Error('Invalid file metadata in payload');
                }

                return {
                    pathname,
                    allowedContentTypes: UPLOAD_CONSTRAINTS.allowedMimeTypes as unknown as string[],
                    addRandomSuffix: true,
                    maximumSizeInBytes: UPLOAD_CONSTRAINTS.maxFileSizeBytes,
                    tokenPayload: JSON.stringify({
                        userId,
                        projectId: clientPayload.projectId,
                        milestoneId: clientPayload.milestoneId,
                        fileId: clientPayload.fileId,
                        fileName: clientPayload.fileName,
                        fileSize: clientPayload.fileSize,
                    } satisfies TokenPayload),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                try {
                    // Validate token payload
                    const payloadBody = JSON.parse(tokenPayload!);
                    const payload = tokenPayloadSchema.parse(payloadBody);

                    const user = await getUserByClerkIdCached(payload.userId);
                    if (!user) {
                        throw new Error('User not found');
                    }

                    await saveFile({
                        userId: user.id,
                        projectId: payload.projectId,
                        milestoneId: payload.milestoneId ?? undefined,
                        fileId: payload.fileId ?? undefined,
                        fileUrl: blob.url,
                        fileName: payload.fileName,
                        fileType: blob.contentType,
                        fileSize: payload.fileSize,
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
        switch (message) {
            case 'Unauthorized':
                return unauthorizedResponse();
            case 'Invalid file metadata in payload':
            case 'Failed to save file metadata':
                return errorResponse(message, {
                    status: 400,
                    code: 'UPLOAD_ERROR',
                });
            default:
                return errorResponse(message, {
                    status: 400,
                    code: 'UPLOAD_ERROR',
                });
        }
    }
}