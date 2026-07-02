import { auth } from '@clerk/nextjs/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { saveFile } from '@/lib/data/file';
import { getUserByClerkIdCached } from '@/lib/data/user';
import { ALLOWED_ATTACHMENT_MIME_TYPES, ClientPayload, clientPayloadSchema, TokenPayload, tokenPayloadSchema, UPLOAD_CONSTRAINTS } from '@/utils/validators';
import { errorResponse, unauthorizedResponse } from '@/utils/validators';
import { LeadAccessError, assertCanAccessLead } from '@/lib/offer/access';

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

                if (clientPayload.leadId) {
                    const user = await getUserByClerkIdCached(userId);
                    if (!user) {
                        throw new Error('Unauthorized');
                    }
                    try {
                        await assertCanAccessLead(user, Number(clientPayload.leadId));
                    } catch (error) {
                        if (error instanceof LeadAccessError) {
                            throw new Error(error.status === 404 ? 'Lead not found' : 'Forbidden');
                        }
                        throw error;
                    }
                }

                let allowedContentTypes: string[] = UPLOAD_CONSTRAINTS.allowedMimeTypes as unknown as string[];
                let addRandomSuffix = true;
                let allowOverwrite = false;

                if (clientPayload.uploadType === 'email-template') {
                    allowedContentTypes = ['text/html']; // Strictly HTML
                    addRandomSuffix = false;
                    allowOverwrite = true;
                    const templatePath = pathname.startsWith('email-ad-hock/')
                        ? pathname.slice('email-ad-hock/'.length)
                        : pathname;
                    pathname = `email-ad-hock/${userId}/${templatePath}`;
                } else if (clientPayload.uploadType === 'email-attachment') {
                    allowedContentTypes = ALLOWED_ATTACHMENT_MIME_TYPES as unknown as string[]; // PDFs, Docs, Images (No HTML)
                    addRandomSuffix = true;
                    allowOverwrite = false;
                }

                return {
                    pathname,
                    allowedContentTypes,
                    addRandomSuffix,
                    allowOverwrite,
                    maximumSizeInBytes: UPLOAD_CONSTRAINTS.maxFileSizeBytes,
                    tokenPayload: JSON.stringify({
                        userId,
                        projectId: clientPayload.projectId,
                        milestoneId: clientPayload.milestoneId,
                        leadId: clientPayload.leadId,
                        fileId: clientPayload.fileId,
                        fileName: clientPayload.fileName,
                        fileSize: clientPayload.fileSize,
                        isOfferFile: clientPayload.isOfferFile,
                        uploadType: clientPayload.uploadType,
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

                    if (payload.isOfferFile || payload.uploadType === 'email-template' || payload.uploadType === 'email-attachment') {
                        console.log(`Skipping file record creation for uploadType: ${payload.uploadType}`);
                        return;
                    }

                    await saveFile({
                        userId: user.id,
                        projectId: payload.projectId,
                        milestoneId: payload.milestoneId ?? undefined,
                        leadId: payload.leadId ?? undefined,
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
            case 'Forbidden':
                return errorResponse(message, {
                    status: 403,
                    code: 'UPLOAD_FORBIDDEN',
                });
            case 'Lead not found':
                return errorResponse(message, {
                    status: 404,
                    code: 'UPLOAD_LEAD_NOT_FOUND',
                });
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
