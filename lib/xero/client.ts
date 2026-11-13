import { XeroClient } from "xero-node";

import { reportExternalError } from "@/lib/observability/external";
import { instrumentApi } from "@/lib/observability/instrument";
import prisma from "@/lib/prisma";

import { getXeroConfig, XERO_SCOPES, type XeroConfig } from "./config";
import { summariseXeroFailure } from "./failure";
import { isInvalidGrant } from "./token-errors";

/**
 * Thrown when no Xero organisation has been connected, or the stored refresh
 * token has been revoked/expired. Typed so callers can tell "nobody has
 * connected Xero yet" — an operator task, surfaced on /admin/xero — apart from
 * a transient Xero outage, which is worth retrying.
 */
export class XeroNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XeroNotConnectedError";
  }
}

export interface XeroContext {
  readonly xero: XeroClient;
  readonly tenantId: string;
}

// Refresh this far before the access token actually expires, so a request that
// passes the check has a usable token for the whole call rather than one that
// lapses mid-flight.
const EXPIRY_SKEW_MS = 120_000;

// The SDK defaults to 3.5s, which covers one hop. The consent callback makes
// two — OpenID discovery, then the code exchange — and a cold serverless
// function pays DNS and TLS on each. 3.5s turns an ordinarily slow round-trip
// into a failed connection.
//
// This only reaches calls that go through openid-client. `refreshWithRefreshToken`
// bypasses it (see REFRESH_TIMEOUT_MS).
const HTTP_TIMEOUT_MS = 20_000;

// `refreshWithRefreshToken` posts through a bare axios call that sets no
// timeout, and axios defaults to waiting forever. Refreshes run inside `after()`
// on the milestone and webhook paths, so a hung socket would silently burn the
// whole function budget and take the progress claim down with it. Time it out
// ourselves; a timeout reads as transient, so the claim is simply retried.
const REFRESH_TIMEOUT_MS = 15_000;

// The SDK defaults to 5s, which leaves no room for ordinary clock drift on any
// timestamp openid-client checks. Cheap insurance, and still far tighter than
// the access token's 30-minute life. (We do not request `openid`, so no
// id_token is verified — see XERO_SCOPES — but the setting costs nothing and
// keeps the flow working if that ever changes.)
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Build a `XeroClient` for one unit of work.
 *
 * Deliberately NOT a module singleton. `XeroClient` stores the token set on the
 * instance and `setTokenSet()` mutates it, so a shared instance lets concurrent
 * requests overwrite each other's credentials — a request can end up making
 * calls with a token that was refreshed out from under it. Constructing one per
 * call costs nothing (no network, no discovery) and removes the whole class of
 * bug.
 */
export function buildXeroClient(
  config: XeroConfig,
  options?: { readonly state?: string },
): XeroClient {
  const client = new XeroClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUris: [config.redirectUri],
    scopes: [...XERO_SCOPES],
    httpTimeout: HTTP_TIMEOUT_MS,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    // `apiCallback` checks the returned state against `config.state`, so the
    // client handling the callback must be built with the same value the
    // consent URL was built with. That is why this is a parameter and not a
    // constant: the callback leg reads it back out of the state cookie.
    ...(options?.state ? { state: options.state } : {}),
  });

  // Every call this app makes to Xero goes through `accountingApi`, from ten
  // places. Hooking it here reports a failed `createInvoices` or `getInvoice`
  // with the operation name, once, wherever it was called from. Callers see the
  // same promise and the same rejection as before.
  //
  // What is REPORTED is a stand-in: the SDK rejects with a JSON string holding
  // the response body (the values submitted) and the request headers (the
  // access token), and only the status and Xero's error type should leave.
  Object.defineProperty(client, "accountingApi", {
    value: instrumentApi("xero", client.accountingApi, {
      summarise: summariseXeroFailure,
    }),
    configurable: true,
    enumerable: true,
    writable: true,
  });
  return client;
}

/**
 * An authenticated client plus the tenant to address, refreshing the stored
 * token when it is close to expiry.
 *
 * @throws {XeroNotConnectedError} If no active connection exists, or refreshing fails.
 */
export async function getXeroContext(): Promise<XeroContext> {
  try {
    return await resolveXeroContext();
  } catch (error) {
    // "Not connected" and "connection revoked" are our credential failing: every
    // invoice, variation and tradie bill stops until a person reconnects, and
    // the first sign is otherwise a client waiting on an invoice. Any status
    // counts here. A database error is not Xero's fault and is left to the
    // paths that already see it.
    if (error instanceof XeroNotConnectedError) {
      reportExternalError("xero", "getContext", error, { force: true });
    }
    throw error;
  }
}

async function resolveXeroContext(): Promise<XeroContext> {
  const config = getXeroConfig();

  const connection = await prisma.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) {
    throw new XeroNotConnectedError(
      "No Xero organisation is connected. Connect one at /admin/xero.",
    );
  }

  const xero = buildXeroClient(config);

  if (connection.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    xero.setTokenSet({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      token_type: "Bearer",
      expires_at: Math.floor(connection.expiresAt.getTime() / 1000),
    });
    return { xero, tenantId: connection.tenantId };
  }

  // `refreshWithRefreshToken` posts straight to the token endpoint;
  // `refreshToken()` would first run OpenID discovery against
  // identity.xero.com, a round-trip this path does not need.
  let tokenSet;
  try {
    tokenSet = await withTimeout(
      xero.refreshWithRefreshToken(
        config.clientId,
        config.clientSecret,
        connection.refreshToken,
      ),
      REFRESH_TIMEOUT_MS,
      "Xero token refresh timed out",
    );
  } catch (error) {
    // Only `invalid_grant` is terminal — the token was revoked, or it went 60
    // days unused and Xero dropped it, and a person has to re-consent.
    //
    // Everything else (a 429, a 5xx, a dropped connection) is transient, and
    // deactivating on it would be self-inflicted damage: one blip would take
    // the organisation offline and demand a manual reconnect for a fault that
    // would have cleared by itself. Xero also keeps a rotated refresh token
    // usable for 30 minutes, so a concurrent double-refresh resolves on its own
    // rather than arriving here.
    if (!isInvalidGrant(error)) {
      console.error("[xero] Token refresh failed transiently:", error);
      // Filtered inside: a 429 is quiet, a 5xx or a dropped connection is not.
      reportExternalError("xero", "refreshToken", error);
      throw error;
    }

    console.error(
      "[xero] Refresh token rejected; deactivating connection:",
      error,
    );
    await prisma.xeroConnection.update({
      where: { id: connection.id },
      data: { isActive: false },
    });
    throw new XeroNotConnectedError(
      "The Xero connection has expired or been revoked. Reconnect at /admin/xero.",
    );
  }

  if (!tokenSet.access_token || !tokenSet.refresh_token) {
    throw new XeroNotConnectedError(
      "Xero returned a token set with no tokens.",
    );
  }

  // Xero ROTATES the refresh token on every refresh and invalidates the old
  // one. Failing to write the new one back bricks the connection at the next
  // refresh, so this write is not optional and must not be deferred.
  await prisma.xeroConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      expiresAt: expiryFromTokenSet(tokenSet.expires_at, tokenSet.expires_in),
      refreshedAt: new Date(),
    },
  });

  return { xero, tenantId: connection.tenantId };
}

/**
 * Reject if a promise has not settled in time.
 *
 * Note this does not cancel the underlying request — nothing in the SDK exposes
 * a signal to cancel it with. It bounds how long we WAIT, which is the part
 * that matters when the caller is a post-response hook with a budget.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Absolute expiry for a token set.
 *
 * `TokenSet` derives `expires_at` (epoch seconds) from `expires_in` in its
 * setter, so in practice it is always present. The fallbacks are belt and
 * braces, ending at Xero's documented 30-minute access-token lifetime rather
 * than at an already-expired date.
 */
export function expiryFromTokenSet(
  expiresAt: number | undefined,
  expiresIn: number | undefined,
): Date {
  if (typeof expiresAt === "number") {
    return new Date(expiresAt * 1000);
  }

  return new Date(Date.now() + (expiresIn ?? 1800) * 1000);
}
