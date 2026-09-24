import prisma from "@/lib/prisma";
import { getXeroConfig } from "@/lib/xero/config";
import {
  getXeroConnectionStatus as getXeroConnectionStatusDomain,
  type XeroConnectionStatus,
} from "@/lib/domain/integrations/xero";

/**
 * What /admin/xero shows about the connection.
 *
 * Deliberately carries no tokens. This crosses to a client component, and the
 * access and refresh tokens are the whole connection — there is no reason for
 * either to leave the server.
 */
export type { XeroConnectionStatus } from "@/lib/domain/integrations/xero";

/** Xero invalidates a refresh token 60 days after it was last used. */
/**
 * The configured sales account, or null.
 *
 * `getXeroConfig()` throws when the client credentials are missing, which is a
 * different and more fundamental problem than an unset account code. Catching
 * keeps the status page renderable in that state instead of erroring out on it.
 */
function salesAccountCode(): string | null {
  try {
    return getXeroConfig().salesAccountCode;
  } catch {
    return null;
  }
}

export async function getXeroConnectionStatus(): Promise<XeroConnectionStatus> {
  return getXeroConnectionStatusDomain(prisma, salesAccountCode());
}
