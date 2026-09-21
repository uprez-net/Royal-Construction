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
  /**
   * The revenue account in the Xero chart of accounts that progress claims post
   * to, e.g. "200" in the default AU/NZ chart.
   *
   * Required to raise a claim, but nullable here because the webhook route also
   * reads this config and has no business failing over an invoicing setting.
   * `createStageInvoice` is where its absence becomes an error.
   *
   * Deliberately not defaulted. Xero ships "200" as Sales in its stock chart,
   * but organisations rename and renumber accounts freely, and guessing means
   * posting revenue to whatever happens to sit at that code.
   */
  readonly salesAccountCode: string | null;
  /**
   * Tax treatment for the claim line, e.g. "OUTPUT" for GST on Income in an
   * Australian organisation.
   *
   * Optional: left unset, Xero derives it from the sales account's own default
   * tax rate, which is the setting the bookkeeper already made deliberately.
   * Set it only to override that.
   */
  readonly salesTaxType: string | null;
}

/**
 * The narrowest set that covers raising a progress claim.
 *
 * - `offline_access` earns the refresh token. Without it the connection dies in
 *   30 minutes with nothing to renew it from, so it is not optional.
 * - `accounting.transactions` writes the invoice.
 * - `accounting.contacts` finds or creates the customer to bill.
 *
 * Deliberately no `openid`/`profile`/`email`. Nothing here uses Xero's notion
 * of who connected — `connectedById` comes from the Clerk session — and asking
 * for them is not free: with `openid` present the SDK routes the callback
 * through `openIdClient.callback()`, which fetches Xero's JWKS and validates
 * the id_token's `iat`/`nbf`. That is a third network hop and a dependency on
 * server clock accuracy, both on the one path a person is sitting and waiting
 * on. Without them it takes the plain `oauthCallback()` branch, which still
 * verifies the CSRF state.
 *
 * `accounting.settings` is absent for the same reason: `updateTenants(false)`
 * reads /connections, which needs no scope, and nothing else asks Xero about
 * the organisation.
 *
 * Every scope here must also be enabled on the app in the Xero developer
 * portal. One that is not makes Xero fail the consent redirect with
 * `invalid_scope` before the login screen — it does not simply grant less.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
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
    throw new Error(
      `Xero is not configured — missing env: ${missing.join(", ")}`,
    );
  }

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    redirectUri: resolveRedirectUri(),
    webhookSecret: process.env.XERO_WEBHOOK_SECRET ?? null,
    salesAccountCode: process.env.XERO_SALES_ACCOUNT_CODE ?? null,
    salesTaxType: process.env.XERO_SALES_TAX_TYPE ?? null,
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
