export type GraphMode = "delegated" | "app-only";
export type GraphMailbox = "business" | "admin";

export interface GraphConfig {
  mailbox: GraphMailbox;
  mode: GraphMode;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderUpn?: string;
  senderUserId: string;
  cc?: string | string[];
  defaultRecipient: string;
  defaultSubject: string;
  defaultBody: string;
  webhookClientState?: string;
  webhookNotificationUrl?: string;
  webhookSubscriptionResource?: string;
  webhookSubscriptionMinutes: number;
  /**
   * Undefined when GRAPH_ADMIN_TOKEN is unset. requireAdminToken fails closed
   * on that, so an unconfigured environment rejects admin routes rather than
   * exposing them. Deliberately not defaulted — a fallback value committed to
   * a public repository is not a secret.
   */
  adminToken?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function parseMode(value: string | undefined): GraphMode {
  if (!value || value === "delegated" || value === "app-only") {
    return (value || "delegated") as GraphMode;
  }

  throw new Error("GRAPH_MODE must be delegated or app-only");
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

function subscriptionResource(
  mode: GraphMode,
  senderUpn: string | undefined,
  mailbox: GraphMailbox,
): string | undefined {
  if (mode === "delegated" && mailbox === "business") {
    return "/me/mailFolders('Inbox')/messages";
  }

  const trimmed = senderUpn?.trim();
  return trimmed
    ? `/users/${encodeURIComponent(trimmed)}/mailFolders('Inbox')/messages`
    : undefined;
}

/**
 * Resolves one of the two deliberately separate Graph mailboxes.
 *
 * Admin values never inherit business values. That makes a missing admin
 * deployment obvious instead of silently sending compliance mail from the
 * lead inbox.
 */
export function getGraphConfig(
  mailbox: GraphMailbox = "business",
): GraphConfig {
  const mode = parseMode(process.env.GRAPH_MODE);
  const isAdmin = mailbox === "admin";
  const senderUpn = isAdmin
    ? process.env.BUSINESS_ADMIN_EMAIL || process.env.GRAPH_ADMIN_SENDER_UPN
    : process.env.BUSINESS_EMAIL || process.env.GRAPH_SENDER_UPN;

  if (isAdmin && !senderUpn?.trim()) {
    throw new Error(
      "Missing admin Graph mailbox. Set BUSINESS_ADMIN_EMAIL or GRAPH_ADMIN_SENDER_UPN.",
    );
  }

  const webhookClientState = isAdmin
    ? requireEnv("GRAPH_ADMIN_WEBHOOK_CLIENT_STATE")
    : process.env.GRAPH_WEBHOOK_CLIENT_STATE || "royal-leadgen-webhook";

  if (
    isAdmin &&
    webhookClientState ===
      (process.env.GRAPH_WEBHOOK_CLIENT_STATE || "royal-leadgen-webhook")
  ) {
    throw new Error(
      "GRAPH_ADMIN_WEBHOOK_CLIENT_STATE must differ from the business client state.",
    );
  }

  const configuredResource = isAdmin
    ? process.env.GRAPH_ADMIN_SUBSCRIPTION_RESOURCE?.trim()
    : process.env.GRAPH_SUBSCRIPTION_RESOURCE?.trim();

  return {
    mailbox,
    mode,
    tenantId: requireEnv("AZURE_TENANT_ID"),
    clientId: requireEnv("AZURE_CLIENT_ID"),
    clientSecret: requireEnv("AZURE_CLIENT_SECRET"),
    senderUpn,
    cc: isAdmin
      ? process.env.GRAPH_ADMIN_MAIL_CC || undefined
      : process.env.MAIL_ID_CC || undefined,
    senderUserId: process.env.GRAPH_SENDER_USER_ID || "",
    defaultRecipient:
      process.env.DEMO_RECIPIENT || "your-recipient@contoso.com",
    defaultSubject: process.env.DEMO_SUBJECT || "Hello from Microsoft Graph",
    defaultBody:
      process.env.DEMO_BODY ||
      "This message was sent using a TypeScript app and the Microsoft Graph API.",
    webhookClientState,
    webhookNotificationUrl: process.env.GRAPH_NOTIFICATION_URL,
    webhookSubscriptionResource:
      configuredResource || subscriptionResource(mode, senderUpn, mailbox),
    webhookSubscriptionMinutes: parseNumber(
      process.env.GRAPH_SUBSCRIPTION_EXPIRATION_MINUTES,
      60,
    ),
    adminToken: process.env.GRAPH_ADMIN_TOKEN || undefined,
  };
}
