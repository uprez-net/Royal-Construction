// The events the bridge sends to the Royal app. This file is the contract;
// docs/whatsapp-bridge.md in the app repository describes the same shapes,
// and lib/whatsapp-bridge/webhook-payload.ts there parses them. Change all
// three together.
//
// Every event is wrapped in one envelope and POSTed, signed, to
// APP_WEBHOOK_URL. Group events are sent ONLY for groups mapped to a project;
// the account's other chats never leave the bridge.

export type SessionStatus =
  | "starting"
  | "connecting"
  | "awaiting_qr"
  | "open"
  | "logged_out"
  | "closed";

export type BridgeAccount = {
  readonly jid: string;
  readonly phoneE164: string | null;
  readonly name: string | null;
};

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export type BridgeMedia = {
  readonly kind: MediaKind;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly caption: string | null;
  /** A voice note recorded in WhatsApp, not an audio file. */
  readonly voice: boolean;
  readonly byteSize: number | null;
  /** Base64 SHA-256 of the decrypted file, when downloaded. */
  readonly sha256: string | null;
  /** True when GET /v1/media/:messageId will return it. */
  readonly available: boolean;
  /** Why it is not available, when it is not. */
  readonly unavailableReason: string | null;
};

export type MessageReceived = {
  readonly groupJid: string;
  /** The project the bridge has this group mapped to. A hint: the app checks. */
  readonly projectId: string;
  readonly messageId: string;
  /** True when Royal's own account wrote it from a phone, not through the API. */
  readonly fromMe: boolean;
  readonly sender: {
    readonly jid: string;
    readonly phoneE164: string | null;
    readonly name: string | null;
  };
  readonly sentAt: string;
  readonly kind: "text" | "media" | "unsupported";
  /** The text, the media caption, or "" when there is neither. */
  readonly text: string;
  readonly media: BridgeMedia | null;
  /** For `unsupported`: WhatsApp's message type, e.g. "locationMessage". */
  readonly unsupportedType: string | null;
};

export type MessageStatus = {
  readonly groupJid: string;
  readonly messageId: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
  readonly at: string;
};

export type GroupUpdated = {
  readonly groupJid: string;
  readonly projectId: string;
  readonly subject: string | null;
};

export type GroupParticipants = {
  readonly groupJid: string;
  readonly projectId: string;
  readonly action: "add" | "remove" | "promote" | "demote";
  readonly participants: readonly {
    readonly jid: string;
    readonly phoneE164: string | null;
  }[];
};

export type SessionUpdated = {
  readonly status: SessionStatus;
  readonly account: BridgeAccount | null;
  readonly reason: string | null;
};

export type BridgeEventMap = {
  "message.received": MessageReceived;
  "message.status": MessageStatus;
  "group.updated": GroupUpdated;
  "group.participants": GroupParticipants;
  "session.updated": SessionUpdated;
};

export type BridgeEventType = keyof BridgeEventMap;

export type BridgeEvent<T extends BridgeEventType = BridgeEventType> = {
  /** Stable for one fact, so a redelivery is recognisable. */
  readonly id: string;
  readonly type: T;
  readonly occurredAt: string;
  readonly data: BridgeEventMap[T];
};
