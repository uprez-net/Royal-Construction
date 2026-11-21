import {
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
  WhatsAppUnmatchedReason,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { WhatsAppChannel } from "../../ports/whatsapp";
import type { DomainPrincipal } from "../../principal";
import {
  whatsappMediaBody,
  whatsappMediaCreateData,
  type InboundWhatsAppMedia,
} from "../../whatsapp/media";
import { waIdToE164 } from "./phone";
import { windowExpiryFor } from "./policy";
import { isUniqueViolation, recordWhatsAppHistory } from "./records";

// A customer's message arriving from Meta (issue #333).
//
// This is reached from a public webhook, after the adapter verified Meta's
// signature. What it must never do:
//
//   - attach a message to the nearest lead. A number that matches no lead, or
//     more than one, goes to the unmatched review queue for a person;
//   - store the same message twice. Meta retries a delivery it did not see
//     acknowledged, so the wamid is unique and a replay is a no-op;
//   - drop anything. A photo, a voice note or a document is recorded with
//     its media (copied into Blob storage by a workflow afterwards), and an
//     unsupported type — a reaction, a location — is still kept with a
//     placeholder body, so the office knows the customer wrote.
//
// Eve never calls this. An agent that says "the customer replied" is quoting
// model text; only the verified webhook may record what arrived.

export type InboundWhatsAppMessage = {
  /** Meta's wamid. */
  readonly providerMessageId: string;
  /** The Royal number it was sent to (metadata.phone_number_id). */
  readonly businessPhoneNumberId: string;
  /** The customer's wa_id — digits with the country code. */
  readonly fromWaId: string;
  readonly profileName?: string | null;
  /** When the customer sent it (Meta's timestamp). */
  readonly sentAt: Date;
  /** Meta's message type: "text", "image", "button", … */
  readonly type: string;
  /**
   * The text, when there is any: a text body, a quick-reply button's label.
   * Null for types that carry none.
   */
  readonly text: string | null;
  /** The attached file, for image/video/audio/document/sticker messages. */
  readonly media?: InboundWhatsAppMedia | null;
};

export type InboundWhatsAppOutcome =
  | {
      readonly outcome: "attached";
      readonly leadId: number;
      readonly conversationId: string;
      readonly messageId: string;
      /** A file now waiting to be copied into Blob storage. */
      readonly mediaId: string | null;
    }
  | {
      readonly outcome: "unmatched";
      readonly unmatchedId: string;
      readonly reason: WhatsAppUnmatchedReason;
      readonly mediaId: string | null;
    }
  | { readonly outcome: "duplicate" };

/** The body stored for a message type the MVP does not render. */
export function unsupportedWhatsAppBody(type: string): string {
  const label = type.trim() || "unsupported";
  return `[${label} message — open WhatsApp on the business phone to view it]`;
}

export function classifyInboundWhatsApp(input: {
  readonly type: string;
  readonly text: string | null;
  readonly media?: InboundWhatsAppMedia | null;
}): {
  kind: WhatsAppMessageKind;
  body: string;
} {
  if (input.media) {
    return {
      body: whatsappMediaBody(input.media),
      kind: WhatsAppMessageKind.MEDIA,
    };
  }
  const text = input.text?.trim();
  return text
    ? { body: text, kind: WhatsAppMessageKind.TEXT }
    : {
        body: unsupportedWhatsAppBody(input.type),
        kind: WhatsAppMessageKind.UNSUPPORTED,
      };
}

export async function recordInboundLeadWhatsAppMessage(
  principal: DomainPrincipal,
  input: InboundWhatsAppMessage,
  db: TransactionalDomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<InboundWhatsAppOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp webhook may record an inbound message.",
    );
  }

  const { body, kind } = classifyInboundWhatsApp(input);
  // An unparseable sender is kept as given, under the unmatched queue — the
  // office can still read it and decide.
  const from =
    waIdToE164(input.fromWaId) ?? `+${input.fromWaId.replace(/\D/g, "")}`;
  const business =
    context.channel?.numbers.find(
      (number) => number.phoneNumberId === input.businessPhoneNumberId,
    ) ?? null;

  try {
    return await db.$transaction(async (tx) => {
      if (await alreadyRecorded(tx, input.providerMessageId)) {
        return { outcome: "duplicate" as const };
      }

      const candidates = business
        ? await tx.lead.findMany({
            orderBy: { id: "asc" },
            select: { id: true },
            // Five is enough to know it is ambiguous; the queue lists them.
            take: 5,
            where: { phoneE164: from },
          })
        : [];

      if (!business || candidates.length !== 1) {
        const reason = !business
          ? WhatsAppUnmatchedReason.UNKNOWN_BUSINESS_NUMBER
          : candidates.length === 0
            ? WhatsAppUnmatchedReason.NO_MATCH
            : WhatsAppUnmatchedReason.AMBIGUOUS;
        const unmatched = await tx.whatsAppUnmatchedMessage.create({
          data: {
            body,
            businessPhoneNumberId: input.businessPhoneNumberId,
            candidateLeadIds: candidates.map((lead) => lead.id),
            fromPhoneE164: from,
            kind,
            profileName: input.profileName?.trim() || null,
            providerMessageId: input.providerMessageId,
            reason,
            receivedAt: input.sentAt,
            ...(input.media
              ? { media: { create: whatsappMediaCreateData(input.media) } }
              : {}),
          },
          select: { id: true, media: { select: { id: true } } },
        });
        return {
          mediaId: unmatched.media?.id ?? null,
          outcome: "unmatched" as const,
          reason,
          unmatchedId: unmatched.id,
        };
      }

      const attached = await attachInbound(tx, {
        body,
        businessDisplayNumber: business.displayNumber,
        businessLabel: business.label,
        businessPhoneNumberId: business.phoneNumberId,
        customerPhoneE164: from,
        kind,
        leadId: candidates[0].id,
        media: input.media
          ? { create: whatsappMediaCreateData(input.media) }
          : null,
        principal,
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt,
        via: "webhook",
      });
      return { outcome: "attached" as const, ...attached };
    });
  } catch (error) {
    // Two deliveries of the same message processed at once: the loser's
    // insert hits the unique wamid. It is the duplicate case, not a failure —
    // but only once the winner's row is really there. Two different messages
    // from one customer racing on the conversation upsert also violate a
    // unique key, and calling that a duplicate would acknowledge a message
    // nobody stored. Rethrowing lets Meta redeliver it.
    if (
      isUniqueViolation(error)
      && (await alreadyRecorded(db, input.providerMessageId))
    ) {
      return { outcome: "duplicate" };
    }
    throw error;
  }
}

async function alreadyRecorded(
  db: DomainDb,
  providerMessageId: string,
): Promise<boolean> {
  const [message, unmatched] = await Promise.all([
    db.leadWhatsAppMessage.findUnique({
      select: { id: true },
      where: { providerMessageId },
    }),
    db.whatsAppUnmatchedMessage.findUnique({
      select: { id: true },
      where: { providerMessageId },
    }),
  ]);
  return Boolean(message || unmatched);
}

/**
 * File an inbound message on a lead's conversation and open its window.
 *
 * Shared by the webhook (exactly one lead matched) and the review queue (a
 * person chose the lead), so both leave the conversation in the same state.
 */
export async function attachInbound(
  db: DomainDb,
  input: {
    readonly leadId: number;
    readonly businessPhoneNumberId: string;
    readonly businessDisplayNumber: string;
    readonly businessLabel: string;
    readonly customerPhoneE164: string;
    readonly providerMessageId: string;
    readonly kind: WhatsAppMessageKind;
    readonly body: string;
    readonly sentAt: Date;
    readonly principal: DomainPrincipal;
    readonly via: "webhook" | "review";
    /**
     * The message's file: a new row from the webhook, or the unmatched
     * message's existing row, moved across when the review queue files it.
     */
    readonly media:
      | { readonly create: ReturnType<typeof whatsappMediaCreateData> }
      | { readonly moveFromUnmatchedId: string }
      | null;
  },
): Promise<{
  leadId: number;
  conversationId: string;
  messageId: string;
  mediaId: string | null;
}> {
  const conversation = await db.leadWhatsAppConversation.upsert({
    create: {
      businessDisplayNumber: input.businessDisplayNumber,
      businessPhoneNumberId: input.businessPhoneNumberId,
      customerPhoneE164: input.customerPhoneE164,
      leadId: input.leadId,
    },
    select: { id: true, lastInboundAt: true, lastMessageAt: true },
    update: {},
    where: {
      leadId_businessPhoneNumberId_customerPhoneE164: {
        businessPhoneNumberId: input.businessPhoneNumberId,
        customerPhoneE164: input.customerPhoneE164,
        leadId: input.leadId,
      },
    },
  });

  const message = await db.leadWhatsAppMessage.create({
    data: {
      body: input.body,
      conversationId: conversation.id,
      direction: WhatsAppMessageDirection.INBOUND,
      kind: input.kind,
      leadId: input.leadId,
      occurredAt: input.sentAt,
      providerMessageId: input.providerMessageId,
      status: WhatsAppMessageStatus.RECEIVED,
      statusAt: input.sentAt,
      ...(input.media && "create" in input.media
        ? { media: { create: input.media.create } }
        : {}),
    },
    select: { id: true, media: { select: { id: true } } },
  });

  let mediaId = message.media?.id ?? null;
  if (input.media && "moveFromUnmatchedId" in input.media) {
    const moved = await db.whatsAppMedia.findUnique({
      select: { id: true },
      where: { unmatchedMessageId: input.media.moveFromUnmatchedId },
    });
    if (moved) {
      await db.whatsAppMedia.update({
        data: { leadMessageId: message.id, unmatchedMessageId: null },
        where: { id: moved.id },
      });
      mediaId = moved.id;
    }
  }

  // A retried delivery from days ago must not move the window backwards, or
  // re-open one that a later message already extended.
  const latestInbound =
    conversation.lastInboundAt
    && conversation.lastInboundAt.getTime() > input.sentAt.getTime()
      ? conversation.lastInboundAt
      : input.sentAt;
  const latestMessage =
    conversation.lastMessageAt
    && conversation.lastMessageAt.getTime() > input.sentAt.getTime()
      ? conversation.lastMessageAt
      : input.sentAt;

  await db.leadWhatsAppConversation.update({
    data: {
      lastInboundAt: latestInbound,
      lastMessageAt: latestMessage,
      unreadCount: { increment: 1 },
      windowExpiresAt: windowExpiryFor(latestInbound),
    },
    where: { id: conversation.id },
  });

  await recordWhatsAppHistory(db, {
    action: "WhatsApp received",
    at: input.sentAt,
    detail:
      input.via === "review"
        ? `Message from ${input.customerPhoneE164} to ${input.businessLabel} (${input.businessDisplayNumber}), filed from the unmatched review queue.`
        : `Message from ${input.customerPhoneE164} to ${input.businessLabel} (${input.businessDisplayNumber}).`,
    leadId: input.leadId,
    principal: input.principal,
  });

  return {
    conversationId: conversation.id,
    leadId: input.leadId,
    mediaId,
    messageId: message.id,
  };
}
