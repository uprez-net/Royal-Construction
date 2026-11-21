// Royal's WhatsApp bridge, as the domain sees it.
//
// Project groups (the owners, the office and site in one chat) go through a
// separate service, services/whatsapp-bridge: a Baileys session linked to
// Royal's WhatsApp number by QR, behind a token-authenticated API. Meta's
// Cloud API (ports/whatsapp.ts) is for leads only — its Groups API needed an
// Official Business Account Royal never had, and could not see groups made on
// a phone.
//
// The production adapter is lib/whatsapp-bridge/client.ts (plain `fetch`),
// constructed by both the App and Eve, so it stays loadable by Node's own ESM
// loader. The API token never crosses this boundary.
//
// docs/whatsapp-bridge.md is the contract between the two services.

import type { WhatsAppMediaPort } from "./whatsapp";

export type WhatsAppBridgeSessionStatus =
  | "starting"
  | "connecting"
  | "awaiting_qr"
  | "open"
  | "logged_out"
  | "closed";

export type WhatsAppBridgeAccount = {
  readonly jid: string;
  readonly phoneE164: string | null;
  readonly name: string | null;
};

export type WhatsAppBridgeSession = {
  readonly status: WhatsAppBridgeSessionStatus;
  readonly account: WhatsAppBridgeAccount | null;
  readonly qrAvailable: boolean;
  readonly qrIssuedAt: string | null;
  readonly lastDisconnect: {
    readonly code: number | null;
    readonly reason: string;
    readonly at: string;
  } | null;
  /** Events waiting to reach the app, and the last delivery problem. */
  readonly outbox: {
    readonly pending: number;
    readonly dead: number;
    readonly delivering: boolean;
    readonly lastDeliveredAt: string | null;
    readonly lastError: string | null;
    readonly lastErrorAt: string | null;
  };
  readonly updatedAt: string;
};

export type WhatsAppBridgeParticipant = {
  readonly jid: string;
  readonly phoneE164: string | null;
  readonly admin: "admin" | "superadmin" | null;
};

export type WhatsAppBridgeGroup = {
  /** The group's WhatsApp id, …@g.us. */
  readonly jid: string;
  readonly subject: string;
  readonly description: string | null;
  readonly createdAt: Date | null;
  readonly participants: readonly WhatsAppBridgeParticipant[];
  /** Royal's number is an admin of the group. */
  readonly isAdmin: boolean;
  /** The project the bridge forwards this group's messages for, if any. */
  readonly mappedProjectId: string | null;
};

export type WhatsAppBridgeSendReceipt = {
  readonly messageId: string;
  readonly sentAt: Date;
  /** The bridge had already sent this key; nothing went out this time. */
  readonly replayed: boolean;
};

export type WhatsAppBridgePort = {
  /**
   * The app can verify the bridge's events (its webhook secret is set).
   * False: calls work, but no group message would ever reach the app.
   */
  readonly receivesEvents: boolean;
  readonly session: () => Promise<WhatsAppBridgeSession>;
  /** Start connecting, so a QR appears when the number is not linked. */
  readonly connect: () => Promise<WhatsAppBridgeSession>;
  /** The current QR as an image, or null when there is none to scan. */
  readonly qr: () => Promise<{
    readonly dataUrl: string;
    readonly issuedAt: string | null;
  } | null>;
  /** Unlink the device. A new QR scan is needed to reconnect. */
  readonly logout: () => Promise<WhatsAppBridgeSession>;
  readonly listGroups: () => Promise<readonly WhatsAppBridgeGroup[]>;
  readonly group: (groupJid: string) => Promise<WhatsAppBridgeGroup>;
  /**
   * May throw WhatsAppSendError: `ambiguous` means the group may exist. With
   * `projectId` the bridge maps the group before answering, so no message
   * posted in the first seconds is missed.
   */
  readonly createGroup: (request: {
    readonly subject: string;
    readonly description: string | null;
    readonly participantsE164: readonly string[];
    readonly projectId: string | null;
  }) => Promise<{
    readonly group: WhatsAppBridgeGroup;
    readonly inviteLink: string | null;
  }>;
  readonly inviteLink: (groupJid: string) => Promise<string>;
  /** May throw WhatsAppSendError, classified `not_sent` or `ambiguous`. */
  readonly sendText: (message: {
    readonly groupJid: string;
    readonly text: string;
    readonly idempotencyKey: string;
  }) => Promise<WhatsAppBridgeSendReceipt>;
  readonly setMapping: (groupJid: string, projectId: string) => Promise<void>;
  /**
   * Unmap a group. With `projectId`, only while it is still that project's,
   * so a late unlink cannot undo a newer link elsewhere.
   */
  readonly removeMapping: (
    groupJid: string,
    projectId?: string,
  ) => Promise<void>;
  readonly replaceMappings: (
    mappings: readonly { groupJid: string; projectId: string }[],
  ) => Promise<{ added: number; removed: number; changed: number }>;
  /** Fetch a group file the bridge downloaded, by its message id. */
  readonly downloadMedia: WhatsAppMediaPort;
};

/**
 * A bridge call that failed. `message` is written for the office and safe to
 * show; `code` is the bridge's (docs/whatsapp-bridge.md) or `unreachable`.
 */
export class WhatsAppBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** The bridge's HTTP status; undefined when it never answered. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "WhatsAppBridgeError";
  }
}

export function isWhatsAppBridgeError(
  error: unknown,
): error is WhatsAppBridgeError {
  return error instanceof WhatsAppBridgeError;
}

/** Bridge codes that mean "the bridge is fine, it just can't do that now". */
export const BRIDGE_NOT_CONNECTED = "not_connected";
