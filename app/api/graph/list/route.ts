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

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const top = Math.min(parseNumber(searchParams.get('top'), 10), 50);
    const includeBody = ['1', 'true', 'yes'].includes(
      (searchParams.get('body') || '').toLowerCase(),
    );

    const client = await createGraphContext(config);
    const items = await client.listInbox(top, includeBody);
    return successResponse({ items });
  } catch (error) {
    console.error('Graph list failed', error);
    return errorResponse('Failed to list inbox', { status: 500, code: 'GRAPH_ERROR' });
  }
}
