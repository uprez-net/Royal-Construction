import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig, type GraphMode } from '@/lib/graph/config';
import { errorResponse, unauthorizedResponse, badRequestResponse } from '@/utils/validators';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface SubscribeBody {
  notificationUrl?: string;
  clientState?: string;
  expirationMinutes?: number;
  resource?: string;
}

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

function buildDefaultResource(mode: GraphMode, senderUpn?: string): string | undefined {
  if (mode === 'delegated') {
    return "/me/mailFolders('Inbox')/messages";
  }

  const trimmed = senderUpn?.trim();
  if (!trimmed) {
    return undefined;
  }

  return `/users/${encodeURIComponent(trimmed)}/mailFolders('Inbox')/messages`;
}

export async function POST(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  let payload: SubscribeBody = {};
  try {
    payload = (await request.json()) as SubscribeBody;
  } catch {
    return badRequestResponse('Invalid JSON body');
  }

  const notificationUrl = payload.notificationUrl || config.webhookNotificationUrl;
  if (!notificationUrl) {
    return badRequestResponse('Missing notification URL');
  }

  const clientState = payload.clientState || config.webhookClientState;
  if (!clientState) {
    return badRequestResponse('Missing client state');
  }

  const expirationMinutes = payload.expirationMinutes ?? config.webhookSubscriptionMinutes;
  const resource =
    payload.resource?.trim() ||
    config.webhookSubscriptionResource ||
    buildDefaultResource(config.mode, config.senderUpn);

  if (!resource) {
    return badRequestResponse('Missing resource path');
  }

  try {
    console.log(`Creating Graph subscription for resource: ${resource}`);
    const client = await createGraphContext(config);
    const subscription = await client.createMailboxSubscription({
      notificationUrl,
      clientState,
      expirationMinutes,
      resource,
    });

    return Response.json(subscription, { status: 201 });
  } catch (error) {
    console.error('Graph subscription failed', error);
    const message = error instanceof Error ? error.message : 'Failed to create subscription';
    return errorResponse(message, { status: 500, code: 'GRAPH_ERROR' });
  }
}
