// Xero OAuth2 configuration.
//
// The integration uses the standard authorization-code grant with a refresh
// token, NOT the `client_credentials` grant the first pass reached for.
// `client_credentials` is Xero's "Custom Connection" — a premium, single-org
// add-on — and it also throws away the tenant discovery step, forcing the
// tenant id to be pasted in as an env var. The authorization-code flow works on
// a standard app, and `updateTenants()` reports the organisation it was
// actually consented against.
//
// Lazy, like `getDocusignConfig()`: reading env at module scope means any file
// that imports this fails at build time when the variables are unset, which is
// exactly what the previous `lib/xero.ts` did.
export interface XeroConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /// Null until the webhook is registered. The notification route refuses to
  /// process anything without it in production.
  readonly webhookSecret: string | null;
}

/**
 * `offline_access` is what earns a refresh token — without it the connection
 * dies in 30 minutes and there is nothing to persist. The accounting scopes are
 * the narrowest set that covers raising a claim: transactions to write the
 * invoice, contacts to resolve the customer, settings to read the organisation.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
] as const;

export function getXeroConfig(): XeroConfig {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;

  const missing = [
    ["XERO_CLIENT_ID", clientId],
    ["XERO_CLIENT_SECRET", clientSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Xero is not configured — missing env: ${missing.join(", ")}`);
  }

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    redirectUri: resolveRedirectUri(),
    webhookSecret: process.env.XERO_WEBHOOK_SECRET ?? null,
  };
}

/**
 * The redirect URI must match a "Redirect URI" registered on the Xero app
 * byte for byte, so an explicit `XERO_REDIRECT_URI` always wins. The derived
 * form is a convenience for local work, where the tunnel host changes often.
 */
function resolveRedirectUri(): string {
  const explicit = process.env.XERO_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "Xero is not configured — set XERO_REDIRECT_URI, or NEXT_PUBLIC_APP_URL to derive it from.",
    );
  }

  return `${appUrl.replace(/\/$/, "")}/api/xero/connect`;
}
