import { WhatsAppMediaType } from "@prisma/client";
import { z } from "zod";

import type { WhatsAppStatusUpdate } from "@/lib/domain/leads/whatsapp/status";
import type { WhatsAppGroupEvent } from "@/lib/domain/projects/whatsapp/group-events";
import type { InboundProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/inbound";

// The WhatsApp bridge's event JSON → the domain's inputs.
//
// The shapes are the bridge's contract (services/whatsapp-bridge/src/events/
// types.ts, described in docs/whatsapp-bridge.md); change all three together.
// Transport validation only: matching a group to a project, deduplicating and
// moving a status forward stay in lib/domain.

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "invalid timestamp",
});
const groupJid = z.string().regex(/^[0-9-]{5,40}@g\.us$/);
const phone = z
  .string()
  .regex(/^\+[1-9]\d{5,14}$/)
  .nullable();

const mediaSchema = z.object({
  available: z.boolean(),
  byteSize: z.number().int().nonnegative().nullable(),
  caption: z.string().max(4096).nullable(),
  fileName: z.string().max(500).nullable(),
  kind: z.enum(["image", "video", "audio", "document", "sticker"]),
  mimeType: z.string().max(200).nullable(),
  sha256: z.string().max(200).nullable(),
  unavailableReason: z.string().max(500).nullable(),
  voice: z.boolean(),
});

const messageReceived = z.object({
  fromMe: z.boolean(),
  groupJid,
  kind: z.enum(["text", "media", "unsupported"]),
  media: mediaSchema.nullable(),
  messageId: z.string().min(1).max(200),
  projectId: z.string().max(100),
  sender: z.object({
    jid: z.string().min(1).max(200),
    name: z.string().max(200).nullable(),
    phoneE164: phone,
  }),
  sentAt: iso,
  text: z.string().max(65_536),
  unsupportedType: z.string().max(100).nullable(),
});

const messageStatus = z.object({
  at: iso,
  groupJid,
  messageId: z.string().min(1).max(200),
  status: z.enum(["sent", "delivered", "read", "failed"]),
});

const groupUpdated = z.object({
  groupJid,
  projectId: z.string().max(100),
  subject: z.string().max(200).nullable(),
});

const groupParticipants = z.object({
  action: z.enum(["add", "remove", "promote", "demote"]),
  groupJid,
  /** Royal's own number is among them (bridges before this field: false). */
  includesSelf: z.boolean().default(false),
  participants: z
    .array(z.object({ jid: z.string().min(1).max(200), phoneE164: phone }))
    .max(1024),
  projectId: z.string().max(100),
});

const sessionUpdated = z.object({
  account: z
    .object({
      jid: z.string(),
      name: z.string().nullable(),
      phoneE164: phone,
    })
    .nullable(),
  reason: z.string().max(1000).nullable(),
  status: z.enum([
    "starting",
    "connecting",
    "awaiting_qr",
    "open",
    "logged_out",
    "closed",
  ]),
});

const envelope = z.object({
  data: z.unknown(),
  id: z.string().min(1).max(300),
  occurredAt: iso,
  type: z.string().min(1).max(100),
});

const MEDIA_TYPES: Record<
  z.infer<typeof mediaSchema>["kind"],
  WhatsAppMediaType
> = {
  audio: WhatsAppMediaType.AUDIO,
  document: WhatsAppMediaType.DOCUMENT,
  image: WhatsAppMediaType.IMAGE,
  sticker: WhatsAppMediaType.STICKER,
  video: WhatsAppMediaType.VIDEO,
};

const STATUS: Record<
  z.infer<typeof messageStatus>["status"],
  WhatsAppStatusUpdate["status"]
> = {
  delivered: "DELIVERED",
  failed: "FAILED",
  read: "READ",
  sent: "SENT",
};

export type ParsedBridgeEvent =
  | {
      readonly kind: "message";
      readonly message: InboundProjectWhatsAppMessage;
    }
  | { readonly kind: "status"; readonly status: WhatsAppStatusUpdate }
  | { readonly kind: "group"; readonly event: WhatsAppGroupEvent }
  | {
      readonly kind: "session";
      readonly status: z.infer<typeof sessionUpdated>["status"];
      readonly reason: string | null;
    }
  /** A well-formed event this app does not act on (promote/demote, a newer type). */
  | { readonly kind: "ignored"; readonly reason: string };

export type BridgeEventParse =
  | {
      readonly ok: true;
      readonly id: string;
      readonly event: ParsedBridgeEvent;
    }
  | { readonly ok: false; readonly error: string };

/** One event, or why it is malformed (the route answers 400 to that). */
export function parseBridgeEvent(body: unknown): BridgeEventParse {
  const outer = envelope.safeParse(body);
  if (!outer.success) return { error: "not a bridge event", ok: false };
  const { id, type, data, occurredAt } = outer.data;
  const fail = (what: string) =>
    ({ error: `${type}: ${what}`, ok: false }) as const;

  switch (type) {
    case "message.received": {
      const parsed = messageReceived.safeParse(data);
      if (!parsed.success) return fail("data did not match");
      const value = parsed.data;
      const media = value.media
        ? {
            caption: value.media.caption,
            fileName: value.media.fileName,
            mimeType: value.media.mimeType,
            providerMediaId: value.messageId,
            sha256: value.media.sha256,
            type: MEDIA_TYPES[value.media.kind],
            unavailableReason: value.media.available
              ? null
              : (value.media.unavailableReason
                ?? "The WhatsApp bridge couldn't download this file."),
            voice: value.media.voice,
          }
        : null;
      return {
        event: {
          kind: "message",
          message: {
            fromMe: value.fromMe,
            groupJid: value.groupJid,
            media,
            projectId: value.projectId,
            providerMessageId: value.messageId,
            senderJid: value.sender.jid,
            senderName: value.sender.name,
            senderPhoneE164: value.sender.phoneE164,
            sentAt: new Date(value.sentAt),
            text: value.text,
            unsupportedType: value.unsupportedType,
          },
        },
        id,
        ok: true,
      };
    }
    case "message.status": {
      const parsed = messageStatus.safeParse(data);
      if (!parsed.success) return fail("data did not match");
      return {
        event: {
          kind: "status",
          status: {
            occurredAt: new Date(parsed.data.at),
            providerMessageId: parsed.data.messageId,
            status: STATUS[parsed.data.status],
          },
        },
        id,
        ok: true,
      };
    }
    case "group.updated": {
      const parsed = groupUpdated.safeParse(data);
      if (!parsed.success) return fail("data did not match");
      if (!parsed.data.subject?.trim()) {
        return {
          event: { kind: "ignored", reason: "no subject" },
          id,
          ok: true,
        };
      }
      return {
        event: {
          event: {
            groupJid: parsed.data.groupJid,
            kind: "subject_changed",
            subject: parsed.data.subject,
          },
          kind: "group",
        },
        id,
        ok: true,
      };
    }
    case "group.participants": {
      const parsed = groupParticipants.safeParse(data);
      if (!parsed.success) return fail("data did not match");
      const { action } = parsed.data;
      if (action !== "add" && action !== "remove") {
        return {
          event: { kind: "ignored", reason: `participants ${action}` },
          id,
          ok: true,
        };
      }
      return {
        event: {
          event: {
            at: new Date(occurredAt),
            groupJid: parsed.data.groupJid,
            includesSelf: parsed.data.includesSelf,
            kind:
              action === "add" ? "participants_added" : "participants_removed",
            participants: parsed.data.participants,
          },
          kind: "group",
        },
        id,
        ok: true,
      };
    }
    case "session.updated": {
      const parsed = sessionUpdated.safeParse(data);
      if (!parsed.success) return fail("data did not match");
      return {
        event: {
          kind: "session",
          reason: parsed.data.reason,
          status: parsed.data.status,
        },
        id,
        ok: true,
      };
    }
    default:
      // A newer bridge with an event this app does not know: accepted, so it
      // is not retried for ever or dead-lettered, and logged.
      return {
        event: { kind: "ignored", reason: `unknown type ${type}` },
        id,
        ok: true,
      };
  }
}
