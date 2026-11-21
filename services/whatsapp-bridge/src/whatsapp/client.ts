import type { BridgeAccount, SessionStatus } from "../events/types.js";

// What the HTTP layer needs from WhatsApp. The Baileys session implements it;
// the tests implement it with a fake, so the API is tested without a phone.

export type SessionState = {
  readonly status: SessionStatus;
  readonly account: BridgeAccount | null;
  /** The raw QR payload while `awaiting_qr`. Rotates every ~20 seconds. */
  readonly qr: string | null;
  readonly qrIssuedAt: string | null;
  readonly lastDisconnect: {
    readonly code: number | null;
    readonly reason: string;
    readonly at: string;
  } | null;
  readonly updatedAt: string;
};

export type GroupParticipant = {
  readonly jid: string;
  readonly phoneE164: string | null;
  readonly admin: "admin" | "superadmin" | null;
};

export type GroupInfo = {
  readonly jid: string;
  readonly subject: string;
  readonly description: string | null;
  readonly createdAt: string | null;
  readonly participants: readonly GroupParticipant[];
  /** Royal's account is an admin, so it can add people and share the link. */
  readonly isAdmin: boolean;
  /** Only admins may post. */
  readonly announce: boolean;
};

export type ParticipantResult = {
  readonly jid: string;
  readonly phoneE164: string | null;
  /** WhatsApp's per-person answer: "200" added, "403" privacy, "409" already in. */
  readonly status: string;
};

export interface WhatsAppClient {
  state(): SessionState;
  /** Connect — and so show a QR when not linked. Idempotent. */
  connect(): Promise<void>;
  /** Unlink this device and wipe its keys. A new QR needs `connect()`. */
  logout(): Promise<void>;
  /** Drop the socket and reconnect with the saved keys. */
  restart(): Promise<void>;
  listGroups(): Promise<GroupInfo[]>;
  groupInfo(groupJid: string): Promise<GroupInfo>;
  createGroup(input: {
    subject: string;
    participantJids: readonly string[];
    description: string | null;
  }): Promise<GroupInfo>;
  inviteLink(groupJid: string): Promise<string>;
  updateParticipants(
    groupJid: string,
    participantJids: readonly string[],
    action: "add" | "remove",
  ): Promise<ParticipantResult[]>;
  /** `messageId` is chosen by the caller so a retry can be recognised. */
  sendText(
    groupJid: string,
    text: string,
    messageId: string,
  ): Promise<{ messageId: string; sentAt: string }>;
  newMessageId(): string;
}

/**
 * A failure the API answers with a status and a code the app acts on.
 *
 * The app's adapter reads `code` to decide whether a send may be retried:
 * `not_connected` and `whatsapp_refused` mean nothing was sent;
 * `send_unconfirmed` means it may have been.
 */
export class BridgeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 502 | 503 | 504,
    readonly code:
      | "bad_request"
      | "not_found"
      | "send_in_progress"
      | "key_conflict"
      | "not_connected"
      | "not_admin"
      | "whatsapp_refused"
      | "send_unconfirmed"
      | "whatsapp_timeout",
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export const NOT_CONNECTED_MESSAGE =
  "The WhatsApp bridge isn't connected. Scan the QR code in Admin › WhatsApp bridge.";
