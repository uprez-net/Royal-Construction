import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig, type GraphMode } from '@/lib/graph/config';
import { NextResponse } from 'next/server';

function buildDefaultResource(mode: GraphMode, senderUpn?: string): string | undefined {
  if (mode === 'delegated') {
    return "/me/mailFolders('Inbox')/messages";
  }
  const trimmed = senderUpn?.trim();
  if (!trimmed) return undefined;
  return `/users/${encodeURIComponent(trimmed)}/mailFolders('Inbox')/messages`;
}

export async function GET(request: Request) {
  // Verify it is a Vercel cron request (standard security check on Vercel environment)
  const authHeader = request.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const config = getGraphConfig();
  const notificationUrl = config.webhookNotificationUrl;
  const clientState = config.webhookClientState || 'royal-leadgen-webhook';
  
  // Set expiration to 4230 minutes (2.9 days - the maximum limit allowed by Microsoft Graph for mail messages)
  const expirationMinutes = 4230; 
  
  const resource = config.webhookSubscriptionResource || buildDefaultResource(config.mode, config.senderUpn);

  if (!notificationUrl || !resource) {
    console.error('Cron Graph subscription failed: missing config variables', { notificationUrl, resource });
    return NextResponse.json({ error: 'Missing webhook configuration' }, { status: 400 });
  }

  try {
    console.log(`Cron: Creating/Renewing Graph subscription for resource: ${resource}`);
    const client = await createGraphContext(config);
    const subscription = await client.createMailboxSubscription({
      notificationUrl,
      clientState,
      expirationMinutes,
      resource,
    });

    console.log(`Cron: Webhook subscription successfully renewed! ID: ${subscription.id}`);
    return NextResponse.json({ success: true, subscription });
  } catch (error) {
    console.error('Cron: Graph subscription renewal failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
