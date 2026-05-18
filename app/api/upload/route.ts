import { auth } from '@clerk/nextjs/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

import { saveFile } from '@/lib/data/file';
import { getUserByClerkId } from '@/lib/data/user';

interface ClientPayload {
    fileId?: string;
    fileName: string;
    projectId: string;
    milestoneId?: string | null;
}

interface TokenPayload {
    fileId?: string;
    fileName: string;
    userId: string;
    projectId: string;
    milestoneId?: string | null;
}

export async function POST(request: Request): Promise<NextResponse> {
    const body = (await request.json()) as HandleUploadBody;

    try {
        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (
                // pathname,
                clientPayload
            ) => {
                const { isAuthenticated, userId } = await auth();
                if (!isAuthenticated) throw new Error('Not authenticated');
                const { projectId, milestoneId, fileName, fileId } = JSON.parse(clientPayload) as ClientPayload;

                return {
                    allowedContentTypes: [
                        'image/jpeg',
                        'image/png',
                        'image/webp',
                        'application/pdf',

                        // Microsoft Word
                        'application/msword', // .doc
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx

                        // Excel
                        'application/vnd.ms-excel', // .xls
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx

                        // CSV
                        'text/csv',
                        'application/csv',
                        'text/plain'
                    ],
                    addRandomSuffix: true,
                    maximumSizeInBytes: 40 * 1024 * 1024, // 40MB
                    tokenPayload: JSON.stringify({
                        userId: userId,
                        projectId,
                        milestoneId,
                        fileId,
                        fileName,
                    }),
                }
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                try {
                    const { userId, projectId, milestoneId, fileName } = JSON.parse(tokenPayload!) as TokenPayload;
                    const user = await getUserByClerkId(userId);
                    if (!user) {
                        throw new Error('User not found');
                    }

                    await saveFile({
                        userId: user.id,
                        projectId,
                        milestoneId: milestoneId ?? undefined,
                        fileUrl: blob.url,
                        fileName,
                    });
                } catch (error) {
                    console.error('Error in onUploadCompleted', error);
                    throw new Error('Could not update user');
                }
            },
        });

        return NextResponse.json(jsonResponse);
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 400 },
        );
    }
}