import { z } from "zod";

import type { InboundWhatsAppMessage } from "@/lib/domain/leads/whatsapp/inbound";
import type { WhatsAppStatusUpdate } from "@/lib/domain/leads/whatsapp/status";

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

const messageSchema = z
  .object({
    from: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string().min(1),
    text: metaText.optional(),
    button: z.object({ text: z.string().optional() }).partial().optional(),
    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z.object({ title: z.string().optional() }).optional(),
        list_reply: z.object({ title: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
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
  })
  .passthrough();

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
  const ignored: string[] = [];

  parsed.data.entry.forEach((entry, entryIndex) => {
    if (entry.id) businessAccountIds.push(entry.id);
    (entry.changes ?? []).forEach((change, changeIndex) => {
      const where = `entry ${entryIndex} change ${changeIndex}`;
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
        const contact = value.data.contacts?.find(
          (candidate) => candidate.wa_id === message.data.from,
        );
        messages.push({
          businessPhoneNumberId: phoneNumberId,
          fromWaId: message.data.from,
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

  return { businessAccountIds, ignored, messages, statuses };
}
