import prisma from "@/lib/prisma";

/**
 * What /admin/xero shows about the connection.
 *
 * Deliberately carries no tokens. This crosses to a client component, and the
 * access and refresh tokens are the whole connection — there is no reason for
 * either to leave the server.
 */
export type XeroConnectionStatus = {
  connected: boolean;
  /** The Xero organisation, as Xero named it. */
  tenantName: string | null;
  /** Who ran the consent flow, for the audit trail. */
  connectedByName: string | null;
  connectedAt: Date | null;
  /** Last successful token refresh — the 60-day clock restarts here. */
  refreshedAt: Date | null;
  /**
   * When the refresh token lapses if nothing uses it before then.
   *
   * Xero expires a refresh token 60 days after its last use, and the failure is
   * silent: progress claims simply stop being raised. Surfacing the date is the
   * difference between noticing and finding out from a customer.
   */
  refreshTokenExpiresAt: Date | null;
};

/** Xero invalidates a refresh token 60 days after it was last used. */
const REFRESH_TOKEN_LIFETIME_DAYS = 60;

const DISCONNECTED: XeroConnectionStatus = {
  connected: false,
  tenantName: null,
  connectedByName: null,
  connectedAt: null,
  refreshedAt: null,
  refreshTokenExpiresAt: null,
};

export async function getXeroConnectionStatus(): Promise<XeroConnectionStatus> {
  const connection = await prisma.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: {
      tenantName: true,
      createdAt: true,
      refreshedAt: true,
      connectedBy: { select: { name: true } },
    },
  });

  if (!connection) {
    return DISCONNECTED;
  }

  const refreshTokenExpiresAt = new Date(connection.refreshedAt);
  refreshTokenExpiresAt.setDate(
    refreshTokenExpiresAt.getDate() + REFRESH_TOKEN_LIFETIME_DAYS,
  );

  return {
    connected: true,
    tenantName: connection.tenantName,
    connectedByName: connection.connectedBy?.name ?? null,
    connectedAt: connection.createdAt,
    refreshedAt: connection.refreshedAt,
    refreshTokenExpiresAt,
  };
}
