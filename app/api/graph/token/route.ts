import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/validators';
import { NextResponse } from 'next/server';

function requireAdminToken(request: Request, adminToken: string): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorizedResponse();
  }

  const token = authHeader.slice(7);
  if (token !== adminToken) {
    return unauthorizedResponse();
  }

  return null;
}

export async function GET(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  try {
    const client = await createGraphContext(config);
    const tokenPreview = await client.getTokenPreview();
    return successResponse({ tokenPreview });
  } catch (error) {
    console.error('Graph token preview failed', error);
    return errorResponse('Failed to acquire token preview', { status: 500, code: 'GRAPH_ERROR' });
  }
}
