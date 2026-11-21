import { DomainSideEffectError, DomainTransitionError } from "../errors";
import {
  isWhatsAppBridgeError,
  type WhatsAppBridgePort,
  type WhatsAppBridgeSession,
} from "../ports/whatsapp-bridge";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";

// Admin › WhatsApp bridge: the bridge's session, its login QR, and
// disconnecting it. Administrators only — the QR links a device to Royal's
// WhatsApp number, and whoever scans it reads every chat on that number.

const NOT_CONFIGURED =
  "The WhatsApp bridge isn't configured. Set WHATSAPP_BRIDGE_URL and WHATSAPP_BRIDGE_API_TOKEN.";

function requireBridge(
  bridge: WhatsAppBridgePort | null | undefined,
): WhatsAppBridgePort {
  if (!bridge) throw new DomainTransitionError(NOT_CONFIGURED);
  return bridge;
}

function failure(error: unknown, fallback: string): DomainSideEffectError {
  return new DomainSideEffectError(
    isWhatsAppBridgeError(error) ? error.message : fallback,
    "whatsapp",
    true,
    { cause: error },
  );
}

export async function getWhatsAppBridgeSession(
  principal: DomainPrincipal,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<WhatsAppBridgeSession> {
  requireAdminPrincipal(principal);
  try {
    return await requireBridge(ports.bridge).session();
  } catch (error) {
    if (error instanceof DomainTransitionError) throw error;
    throw failure(error, "The WhatsApp bridge couldn't be reached.");
  }
}

/** Start connecting, so a QR appears. Safe to press twice. */
export async function connectWhatsAppBridge(
  principal: DomainPrincipal,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<WhatsAppBridgeSession> {
  requireAdminPrincipal(principal);
  try {
    return await requireBridge(ports.bridge).connect();
  } catch (error) {
    if (error instanceof DomainTransitionError) throw error;
    throw failure(error, "The WhatsApp bridge couldn't be reached.");
  }
}

/** The QR to scan, or null when there is none right now. */
export async function getWhatsAppBridgeQr(
  principal: DomainPrincipal,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<{ dataUrl: string; issuedAt: string | null } | null> {
  requireAdminPrincipal(principal);
  try {
    return await requireBridge(ports.bridge).qr();
  } catch (error) {
    if (error instanceof DomainTransitionError) throw error;
    throw failure(error, "The WhatsApp bridge couldn't be reached.");
  }
}

/**
 * Unlink the bridge from Royal's number. Project groups stop syncing until
 * someone scans a new QR; the groups themselves and their links are kept.
 */
export async function disconnectWhatsAppBridge(
  principal: DomainPrincipal,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<WhatsAppBridgeSession> {
  requireAdminPrincipal(principal);
  try {
    return await requireBridge(ports.bridge).logout();
  } catch (error) {
    if (error instanceof DomainTransitionError) throw error;
    throw failure(error, "The WhatsApp bridge couldn't be disconnected.");
  }
}
