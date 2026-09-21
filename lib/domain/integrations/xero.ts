import type { DomainDb } from "../db";
import { DomainTransitionError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";

export type XeroConnectionStatus = {
  connected: boolean;
  tenantName: string | null;
  connectedByName: string | null;
  connectedAt: Date | null;
  refreshedAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  salesAccountCode: string | null;
};

const REFRESH_TOKEN_LIFETIME_DAYS = 60;

export async function getXeroConnectionStatus(
  db: DomainDb,
  salesAccountCode: string | null,
): Promise<XeroConnectionStatus> {
  const connection = await db.xeroConnection.findFirst({
    orderBy: { updatedAt: "desc" },
    select: {
      connectedBy: { select: { name: true } },
      createdAt: true,
      refreshedAt: true,
      tenantName: true,
    },
    where: { isActive: true },
  });
  if (!connection) {
    return {
      connected: false,
      connectedAt: null,
      connectedByName: null,
      refreshTokenExpiresAt: null,
      refreshedAt: null,
      salesAccountCode,
      tenantName: null,
    };
  }
  const refreshTokenExpiresAt = new Date(connection.refreshedAt);
  refreshTokenExpiresAt.setDate(
    refreshTokenExpiresAt.getDate() + REFRESH_TOKEN_LIFETIME_DAYS,
  );
  return {
    connected: true,
    connectedAt: connection.createdAt,
    connectedByName: connection.connectedBy?.name ?? null,
    refreshTokenExpiresAt,
    refreshedAt: connection.refreshedAt,
    salesAccountCode,
    tenantName: connection.tenantName,
  };
}

export type DisconnectXeroResult = {
  disconnected: boolean;
  connectionId: string | null;
  tenantName: string | null;
  revocationFailed: boolean;
};

export type XeroCredentials = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

/**
 * Revoke the external token through an injected port, then deactivate locally.
 *
 * Xero may already have expired a refresh token. That is the safe end state,
 * so local deactivation still lands when the revoke port fails; the result
 * exposes that fact for the adapter's logs/audit instead of reporting a silent
 * perfect revoke.
 */
export async function disconnectXero(
  principal: DomainPrincipal,
  db: DomainDb,
  revoke: (credentials: XeroCredentials) => Promise<void>,
): Promise<DisconnectXeroResult> {
  requireAdminPrincipal(principal);
  const active = await db.xeroConnection.findFirst({
    orderBy: { updatedAt: "desc" },
    select: {
      accessToken: true,
      id: true,
      refreshToken: true,
      tenantName: true,
    },
    where: { isActive: true },
  });
  if (!active) {
    return {
      connectionId: null,
      disconnected: false,
      revocationFailed: false,
      tenantName: null,
    };
  }

  let revocationFailed = false;
  try {
    await revoke({
      accessToken: active.accessToken,
      refreshToken: active.refreshToken,
    });
  } catch {
    revocationFailed = true;
  }
  const updated = await db.xeroConnection.updateMany({
    data: { isActive: false },
    where: { id: active.id, isActive: true },
  });
  if (updated.count !== 1) {
    throw new DomainTransitionError(
      "The Xero connection changed before it could be disconnected.",
    );
  }
  return {
    connectionId: active.id,
    disconnected: true,
    revocationFailed,
    tenantName: active.tenantName,
  };
}
