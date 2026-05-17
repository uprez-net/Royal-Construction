import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { jsonError, requireAdminToken } from '@/lib/graph/route-utils';

export const runtime = 'nodejs';

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

  const { searchParams } = new URL(request.url);
  const top = Math.min(parseNumber(searchParams.get('top'), 10), 50);
  const includeBody = ['1', 'true', 'yes'].includes(
    (searchParams.get('body') || '').toLowerCase(),
  );

  try {
    const client = await createGraphContext(config);
    const items = await client.listInbox(top, includeBody);
    return Response.json({ items });
  } catch (error) {
    console.error('Graph list failed', error);
    return jsonError('Failed to list inbox', 500);
  }
}
