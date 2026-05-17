import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { jsonError, requireAdminToken } from '@/lib/graph/route-utils';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  try {
    const client = await createGraphContext(config);
    const tokenPreview = await client.getTokenPreview();
    return Response.json({ tokenPreview });
  } catch (error) {
    console.error('Graph token preview failed', error);
    return jsonError('Failed to acquire token preview', 500);
  }
}
