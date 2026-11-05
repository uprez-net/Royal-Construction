import { z } from "zod";

import type { InboundWhatsAppMessage } from "@/lib/domain/leads/whatsapp/inbound";
import type { WhatsAppStatusUpdate } from "@/lib/domain/leads/whatsapp/status";
import type { WhatsAppGroupEvent } from "@/lib/domain/projects/whatsapp/groups";
import type { WhatsAppCallPermissionReply } from "@/lib/domain/leads/whatsapp/call-permissions";
import type { WhatsAppCallEvent } from "@/lib/domain/leads/whatsapp/calls";
import {
  whatsappMediaTypeOf,
  type InboundWhatsAppMedia,
} from "@/lib/domain/whatsapp/media";

import { describeWhatsAppError } from "./errors";

// Meta's WhatsApp webhook JSON → the domain's inbound and status events
// (issue #333).
//
// Transport validation only: the shape is parsed here and the business rules
// (matching a lead, deduplicating, moving a status forward) stay in
// lib/domain/leads/whatsapp. Parsing is lenient about fields it does not use
// and strict about the ones it does — a message with no id or no sender is
// skipped with a reason rather than guessed at, because the id is what makes
// a retried delivery harmless.
//
// Reasons never carry a body, a name or a phone number: the route logs them.

const metaText = z.object({ body: z.string() }).partial();

/** image, video, audio, document and sticker all carry this shape. */
const metaMedia = z
  .object({
    id: z.string().min(1),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
    voice: z.boolean().optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    from: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string().min(1),
    /** Present when it was posted in a group. */
    group_id: z.string().min(1).optional(),
    text: metaText.optional(),
    image: metaMedia.optional(),
    video: metaMedia.optional(),
    audio: metaMedia.optional(),
    document: metaMedia.optional(),
    sticker: metaMedia.optional(),
    button: z.object({ text: z.string().optional() }).partial().optional(),
    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z.object({ title: z.string().optional() }).optional(),
        list_reply: z.object({ title: z.string().optional() }).optional(),
        call_permission_reply: z
          .object({
            response: z.string().optional(),
            is_permanent: z.boolean().optional(),
            expiration_timestamp: z.union([z.string(), z.number()]).optional(),
          })
          .partial()
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
    /** "call" for a call's ringing/accepted/rejected status. */
    type: z.string().optional(),
    biz_opaque_callback_data: z.string().optional(),
    errors: z
      .array(
        z
          .object({
            code: z.union([z.number(), z.string()]).optional(),
            title: z.string().optional(),
            message: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const valueSchema = z
  .object({
    metadata: z
      .object({ phone_number_id: z.string().min(1) })
      .passthrough()
      .optional(),
    contacts: z
      .array(
        z
          .object({
            wa_id: z.string().optional(),
            profile: z.object({ name: z.string().optional() }).optional(),
          })
          .passthrough(),
      )
      .optional(),
    messages: z.array(z.unknown()).optional(),
    statuses: z.array(z.unknown()).optional(),
    /** The group_* fields carry their events here. */
    groups: z.array(z.unknown()).optional(),
    /** The `calls` field carries its events here. */
    calls: z.array(z.unknown()).optional(),
  })
  .passthrough();

const groupErrors = z
  .array(
    z
      .object({
        code: z.union([z.number(), z.string()]).optional(),
        title: z.string().optional(),
        message: z.string().optional(),
      })
      .passthrough(),
  )
  .optional();

const participantList = z
  .array(z.object({ wa_id: z.string().optional() }).passthrough())
  .optional();

const groupEventSchema = z
  .object({
    timestamp: z.union([z.string(), z.number()]).optional(),
    group_id: z.string().optional(),
    type: z.string().min(1),
    request_id: z.string().optional(),
    subject: z.string().optional(),
    invite_link: z.string().optional(),
    errors: groupErrors,
    added_participants: participantList,
    removed_participants: participantList,
    group_subject: z
      .object({
        text: z.string().optional(),
        update_successful: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

/** The webhook fields that carry group events. */
const GROUP_FIELDS = new Set([
  "group_lifecycle_update",
  "group_participants_update",
  "group_settings_update",
  "group_status_update",
]);

const payloadSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          id: z.string().optional(),
          changes: z
            .array(
              z
                .object({ field: z.string().optional(), value: z.unknown() })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type ParsedWhatsAppWebhook = {
  /** WhatsApp Business Account ids named by the delivery (`entry[].id`). */
  readonly businessAccountIds: readonly string[];
  readonly messages: readonly InboundWhatsAppMessage[];
  readonly statuses: readonly WhatsAppStatusUpdate[];
  readonly groupEvents: readonly WhatsAppGroupEvent[];
  readonly callEvents: readonly WhatsAppCallEvent[];
  readonly callPermissionReplies: readonly WhatsAppCallPermissionReply[];
  /** Why parts of the delivery were skipped. Safe to log. */
  readonly ignored: readonly string[];
};

const STATUS_MAP: Record<string, WhatsAppStatusUpdate["status"]> = {
  delivered: "DELIVERED",
  failed: "FAILED",
  read: "READ",
  sent: "SENT",
};

function secondsToDate(seconds: string): Date {
  return new Date(Number(seconds) * 1000);
}

/** The text a customer sent, from whichever field Meta put it in. */
function inboundText(message: z.infer<typeof messageSchema>): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body ?? null;
    case "button":
      // A tap on a template's quick-reply button.
      return message.button?.text ?? null;
    case "interactive":
      return (
        message.interactive?.button_reply?.title
        ?? message.interactive?.list_reply?.title
        ?? null
      );
    default:
      return null;
  }
}

type MediaField = "image" | "video" | "audio" | "document" | "sticker";

/** The attached file, for a media message type. */
function inboundMedia(
  message: z.infer<typeof messageSchema>,
): InboundWhatsAppMedia | null {
  const type = whatsappMediaTypeOf(message.type);
  if (!type) return null;
  const object = message[message.type as MediaField];
  if (!object) return null;
  return {
    caption: object.caption ?? null,
    fileName: object.filename ?? null,
    mimeType: object.mime_type ?? null,
    providerMediaId: object.id,
    sha256: object.sha256 ?? null,
    type,
    voice: object.voice === true,
  };
}

function eventTime(timestamp: string | number | undefined): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

function participantIds(list: z.infer<typeof participantList>): string[] {
  return (list ?? [])
    .map((participant) => participant.wa_id?.trim())
    .filter((id): id is string => Boolean(id));
}

/** One groups[] entry, as the domain's event or a reason it was skipped. */
function groupEvent(
  raw: unknown,
): { event: WhatsAppGroupEvent } | { ignored: string } {
  const parsed = groupEventSchema.safeParse(raw);
  if (!parsed.success) return { ignored: "group event without a type" };
  const value = parsed.data;
  const at = eventTime(value.timestamp);
  const groupId = value.group_id?.trim() || null;
  const error = value.errors?.[0];

  switch (value.type) {
    case "group_create":
      if (error) {
        return {
          event: {
            at,
            groupId,
            kind: "create_failed",
            reason: describeWhatsAppError(
              error.code === undefined ? undefined : Number(error.code),
              error.title ?? error.message,
            ),
            requestId: value.request_id ?? null,
          },
        };
      }
      if (!groupId) return { ignored: "group_create without a group_id" };
      return {
        event: {
          at,
          groupId,
          inviteLink: value.invite_link ?? null,
          kind: "created",
          requestId: value.request_id ?? null,
          subject: value.subject ?? null,
        },
      };
    case "group_delete":
      if (error || !groupId) {
        return { ignored: "group_delete failed or unnamed" };
      }
      return { event: { at, groupId, kind: "deleted" } };
    case "group_participants_add":
      if (!groupId) return { ignored: "participants_add without a group_id" };
      return {
        event: {
          at,
          groupId,
          kind: "participants_added",
          waIds: participantIds(value.added_participants),
        },
      };
    case "group_participants_remove":
      if (!groupId) {
        return { ignored: "participants_remove without a group_id" };
      }
      return {
        event: {
          at,
          groupId,
          kind: "participants_removed",
          waIds: participantIds(value.removed_participants),
        },
      };
    case "group_suspend":
    case "group_suspend_cleared":
      if (!groupId) return { ignored: "suspension event without a group_id" };
      return {
        event: {
          at,
          groupId,
          kind:
            value.type === "group_suspend" ? "suspended" : "suspension_cleared",
        },
      };
    case "group_settings_update": {
      const subject = value.group_subject;
      if (!groupId || !subject?.update_successful || !subject.text) {
        return { ignored: "group_settings_update with no subject change" };
      }
      return {
        event: { at, groupId, kind: "subject_changed", subject: subject.text },
      };
    }
    default:
      // Join requests and anything newer: nothing this app acts on yet.
      return { ignored: "group event type is not handled" };
  }
}

const callSchema = z
  .object({
    id: z.string().min(1).max(200),
    event: z.string().optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    direction: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    session: z
      .object({ sdp_type: z.string().max(20), sdp: z.string().max(20_000) })
      .optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    biz_opaque_callback_data: z.string().max(512).optional(),
  })
  .passthrough();

/** One calls[] entry (Meta's Calling API), or why it was skipped. */
function callEvent(
  raw: unknown,
  phoneNumberId: string,
): { event: WhatsAppCallEvent } | { ignored: string } {
  const parsed = callSchema.safeParse(raw);
  if (!parsed.success) return { ignored: "call event without an id" };
  const value = parsed.data;
  const at = eventTime(value.timestamp);
  const opaque = value.biz_opaque_callback_data?.trim() || null;
  if (value.event === "connect") {
    const businessInitiated = value.direction === "BUSINESS_INITIATED";
    const customer = businessInitiated ? value.to : value.from;
    const sdpType = value.session?.sdp_type?.toLowerCase();
    if (!customer) return { ignored: "call connect without the customer" };
    return {
      event: {
        at,
        bizOpaqueCallbackData: opaque,
        businessPhoneNumberId: phoneNumberId,
        customerWaId: customer,
        kind: "connect",
        providerCallId: value.id,
        sdp: value.session?.sdp ?? null,
        sdpType: sdpType === "offer" || sdpType === "answer" ? sdpType : null,
      },
    };
  }
  if (value.event === "terminate") {
    const status = [value.status].flat().join(",").toUpperCase();
    const duration = Number(value.duration);
    return {
      event: {
        at,
        bizOpaqueCallbackData: opaque,
        durationSeconds:
          Number.isFinite(duration) && duration >= 0
            ? Math.round(duration)
            : null,
        kind: "terminate",
        providerCallId: value.id,
        status: status.includes("FAILED") ? "FAILED" : "COMPLETED",
      },
    };
  }
  return { ignored: "call event is not handled" };
}

/** A call's ringing/accepted/rejected status, from statuses[] with type "call". */
function callStatusEvent(
  status: z.infer<typeof statusSchema>,
): WhatsAppCallEvent | null {
  const value = status.status.toUpperCase();
  if (value !== "RINGING" && value !== "ACCEPTED" && value !== "REJECTED") {
    return null;
  }
  return {
    at: secondsToDate(status.timestamp),
    bizOpaqueCallbackData: status.biz_opaque_callback_data?.trim() || null,
    kind: "status",
    providerCallId: status.id,
    status: value,
  };
}

/**
 * Parse one delivery. Returns null when the body is not a WhatsApp Business
 * Account webhook at all — the route answers 400 to that, since retrying the
 * same bytes will not help.
 */
export function parseWhatsAppWebhook(
  body: unknown,
): ParsedWhatsAppWebhook | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") {
    return null;
  }

  const businessAccountIds: string[] = [];
  const messages: InboundWhatsAppMessage[] = [];
  const statuses: WhatsAppStatusUpdate[] = [];
  const groupEvents: WhatsAppGroupEvent[] = [];
  const callEvents: WhatsAppCallEvent[] = [];
  const callPermissionReplies: WhatsAppCallPermissionReply[] = [];
  const ignored: string[] = [];

  parsed.data.entry.forEach((entry, entryIndex) => {
    if (entry.id) businessAccountIds.push(entry.id);
    (entry.changes ?? []).forEach((change, changeIndex) => {
      const where = `entry ${entryIndex} change ${changeIndex}`;
      if (change.field && GROUP_FIELDS.has(change.field)) {
        const groupValue = valueSchema.safeParse(change.value);
        if (!groupValue.success) {
          ignored.push(where + ": value did not match the groups shape");
          return;
        }
        (groupValue.data.groups ?? []).forEach((raw, index) => {
          const result = groupEvent(raw);
          if ("event" in result) groupEvents.push(result.event);
          else ignored.push(where + " group " + index + ": " + result.ignored);
        });
        return;
      }
      if (change.field === "calls") {
        const callValue = valueSchema.safeParse(change.value);
        const callNumber = callValue.success
          ? callValue.data.metadata?.phone_number_id
          : undefined;
        if (!callValue.success || !callNumber) {
          ignored.push(where + ": value did not match the calls shape");
          return;
        }
        (callValue.data.calls ?? []).forEach((raw, index) => {
          const result = callEvent(raw, callNumber);
          if ("event" in result) callEvents.push(result.event);
          else ignored.push(where + " call " + index + ": " + result.ignored);
        });
        (callValue.data.statuses ?? []).forEach((raw, index) => {
          const status = statusSchema.safeParse(raw);
          const event = status.success ? callStatusEvent(status.data) : null;
          if (event) callEvents.push(event);
          else ignored.push(where + " call status " + index + ": not tracked");
        });
        return;
      }
      if (change.field !== "messages") {
        ignored.push(
          `${where}: field "${change.field ?? "none"}" is not handled`,
        );
        return;
      }
      const value = valueSchema.safeParse(change.value);
      if (!value.success) {
        ignored.push(`${where}: value did not match the messages shape`);
        return;
      }
      const phoneNumberId = value.data.metadata?.phone_number_id;
      if (!phoneNumberId) {
        ignored.push(`${where}: no metadata.phone_number_id`);
        return;
      }

      (value.data.messages ?? []).forEach((raw, index) => {
        const message = messageSchema.safeParse(raw);
        if (!message.success) {
          ignored.push(
            `${where} message ${index}: missing id, sender or timestamp`,
          );
          return;
        }
        const permission = message.data.interactive?.call_permission_reply;
        if (
          message.data.type === "interactive"
          && message.data.interactive?.type === "call_permission_reply"
          && permission
        ) {
          // The customer's tap on Allow or Decline. Never an ordinary reply:
          // only this tap grants permission (file 01 section 14).
          const expires = Number(permission.expiration_timestamp);
          callPermissionReplies.push({
            accepted: permission.response === "accept",
            at: secondsToDate(message.data.timestamp),
            businessPhoneNumberId: phoneNumberId,
            expiresAt:
              Number.isFinite(expires) && expires > 0
                ? new Date(expires * 1000)
                : null,
            fromWaId: message.data.from,
            permanent: permission.is_permanent === true,
          });
          return;
        }
        const contact = value.data.contacts?.find(
          (candidate) => candidate.wa_id === message.data.from,
        );
        messages.push({
          businessPhoneNumberId: phoneNumberId,
          fromWaId: message.data.from,
          groupId: message.data.group_id ?? null,
          media: inboundMedia(message.data),
          profileName: contact?.profile?.name ?? null,
          providerMessageId: message.data.id,
          sentAt: secondsToDate(message.data.timestamp),
          text: inboundText(message.data),
          type: message.data.type,
        });
      });

      (value.data.statuses ?? []).forEach((raw, index) => {
        const status = statusSchema.safeParse(raw);
        if (!status.success) {
          ignored.push(
            `${where} status ${index}: missing id, status or timestamp`,
          );
          return;
        }
        if (status.data.type === "call") {
          const event = callStatusEvent(status.data);
          if (event) callEvents.push(event);
          return;
        }
        const mapped = STATUS_MAP[status.data.status];
        if (!mapped) {
          ignored.push(
            `${where} status ${index}: status "${status.data.status}" is not tracked`,
          );
          return;
        }
        const error = status.data.errors?.[0];
        const code = error?.code === undefined ? null : String(error.code);
        statuses.push({
          errorCode: mapped === "FAILED" ? code : null,
          errorTitle:
            mapped === "FAILED"
              ? describeWhatsAppError(code, error?.title ?? error?.message)
              : null,
          occurredAt: secondsToDate(status.data.timestamp),
          providerMessageId: status.data.id,
          status: mapped,
        });
      });
    });
  });

  return {
    businessAccountIds,
    callEvents,
    callPermissionReplies,
    groupEvents,
    ignored,
    messages,
    statuses,
  };
}
