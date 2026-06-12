import { auth } from '@clerk/nextjs/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Enforce user authentication
        const { isAuthenticated } = await auth();
        if (!isAuthenticated) {
          throw new Error('Unauthorized');
        }

        // Build the callback URL dynamically based on the request host
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
        const callbackUrl = `${protocol}://${host}/api/upload/email-ad-hock`;

        return {
          allowedContentTypes: ['text/html'], // Restrict to HTML files
          addRandomSuffix: false,             // ✅ Forces exact filename on server (prevents random suffix generation)
          allowOverwrite: true,               // ✅ Allows overwriting on server (overwrites existing index.html)
          callbackUrl,                        // ✅ Required when onUploadCompleted is defined
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Blob upload completed:', blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Error generating upload token:', error);
    const message = (error as Error).message || 'Upload failed';
    if (message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Upload token generation failed' },
      { status: 500 }
    );
  }
}