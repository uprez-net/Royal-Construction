export type GraphMode = 'delegated' | 'app-only';

export interface GraphConfig {
  mode: GraphMode;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderUpn?: string;
  senderUserId?: string;
  defaultRecipient: string;
  defaultSubject: string;
  defaultBody: string;
  webhookClientState?: string;
  webhookNotificationUrl?: string;
  webhookSubscriptionResource?: string;
  webhookSubscriptionMinutes: number;
  adminToken: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function parseMode(value: string | undefined): GraphMode {
  if (!value || value === 'delegated' || value === 'app-only') {
    return (value || 'delegated') as GraphMode;
  }

  throw new Error('GRAPH_MODE must be delegated or app-only');
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return parsed;
}

export function getGraphConfig(): GraphConfig {
  const mode = parseMode(process.env.GRAPH_MODE);

  return {
    mode,
    tenantId: requireEnv('AZURE_TENANT_ID'),
    clientId: requireEnv('AZURE_CLIENT_ID'),
    clientSecret: requireEnv('AZURE_CLIENT_SECRET'),
    senderUpn: process.env.BUSINESS_EMAIL || process.env.GRAPH_SENDER_UPN,
    senderUserId: process.env.GRAPH_SENDER_USER_ID,
    defaultRecipient: process.env.DEMO_RECIPIENT || 'your-recipient@contoso.com',
    defaultSubject: process.env.DEMO_SUBJECT || 'Hello from Microsoft Graph',
    defaultBody:
      process.env.DEMO_BODY ||
      'This message was sent using a TypeScript app and the Microsoft Graph API.',
    webhookClientState: process.env.GRAPH_WEBHOOK_CLIENT_STATE || 'royal-leadgen-webhook',
    webhookNotificationUrl: process.env.GRAPH_NOTIFICATION_URL,
    webhookSubscriptionResource:
      process.env.GRAPH_SUBSCRIPTION_RESOURCE?.trim() || undefined,
    webhookSubscriptionMinutes: parseNumber(
      process.env.GRAPH_SUBSCRIPTION_EXPIRATION_MINUTES,
      60,
    ),
    adminToken: process.env.GRAPH_ADMIN_TOKEN ?? "test-admin-token",
  };
}
