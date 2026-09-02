import { XeroClient } from "xero-node";

import prisma from "@/lib/prisma";

import { getXeroConfig, XERO_SCOPES, type XeroConfig } from "./config";

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
  return new XeroClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUris: [config.redirectUri],
    scopes: [...XERO_SCOPES],
    ...(options?.state ? { state: options.state } : {}),
  });
}

/**
 * An authenticated client plus the tenant to address, refreshing the stored
 * token when it is close to expiry.
 *
 * @throws {XeroNotConnectedError} If no active connection exists, or refreshing fails.
 */
export async function getXeroContext(): Promise<XeroContext> {
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
    tokenSet = await xero.refreshWithRefreshToken(
      config.clientId,
      config.clientSecret,
      connection.refreshToken,
    );
  } catch (error) {
    // A rejected refresh token is terminal: it has been revoked, or it went
    // 60 days unused and Xero dropped it. Someone has to re-consent.
    console.error("[xero] Token refresh failed:", error);
    await prisma.xeroConnection.update({
      where: { id: connection.id },
      data: { isActive: false },
    });
    throw new XeroNotConnectedError(
      "The Xero connection has expired or been revoked. Reconnect at /admin/xero.",
    );
  }

  if (!tokenSet.access_token || !tokenSet.refresh_token) {
    throw new XeroNotConnectedError("Xero returned a token set with no tokens.");
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
 * Absolute expiry for a token set. `openid-client` normally resolves
 * `expires_at` (epoch seconds) itself, but the direct token request only
 * returns `expires_in`, so fall back to that and finally to Xero's documented
 * 30-minute access-token lifetime.
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
