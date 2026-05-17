import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig, type GraphMode } from '@/lib/graph/config';
import { jsonError, requireAdminToken } from '@/lib/graph/route-utils';

export const runtime = 'nodejs';

interface SubscribeBody {
  notificationUrl?: string;
  clientState?: string;
  expirationMinutes?: number;
  resource?: string;
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
    return jsonError('Invalid JSON body', 400);
  }

  const notificationUrl = payload.notificationUrl || config.webhookNotificationUrl;
  if (!notificationUrl) {
    return jsonError('Missing "notificationUrl"', 400);
  }

  const clientState = payload.clientState || config.webhookClientState;
  if (!clientState) {
    return jsonError('Missing "clientState"', 400);
  }

  const expirationMinutes = payload.expirationMinutes ?? config.webhookSubscriptionMinutes;
  const resource =
    payload.resource?.trim() ||
    config.webhookSubscriptionResource ||
    buildDefaultResource(config.mode, config.senderUpn);

  if (!resource) {
    return jsonError('Missing "resource"', 400);
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
    return jsonError(message, 500);
  }
}
