import {
  ProjectWhatsAppGroupStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppUnmatchedReason,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError, DomainValidationError } from "../../errors";
import type { DomainPrincipal } from "../../principal";
import {
  classifyInboundWhatsApp,
  type InboundWhatsAppMessage,
} from "../../leads/whatsapp/inbound";
import { waIdToE164 } from "../../leads/whatsapp/phone";
import { isUniqueViolation } from "../../leads/whatsapp/records";
import { whatsappMediaCreateData } from "../../whatsapp/media";

// A message posted in a project's WhatsApp group, arriving from Meta.
//
// The same promises as a lead's inbound message (lib/domain/leads/whatsapp/
// inbound.ts): never stored twice — Meta retries, and the wamid is unique —
// and never dropped. A group no project is linked to yet keeps its messages
// in the unmatched table as UNLINKED_GROUP; linking the group files them.
//
// Unlike a lead's conversation there is no customer-service window to open
// and no lead to match: the group is the correlation key.

export type InboundProjectWhatsAppOutcome =
  | {
      readonly outcome: "attached";
      readonly projectId: string;
      readonly messageId: string;
      readonly mediaId: string | null;
    }
  | {
      readonly outcome: "unlinked";
      readonly unmatchedId: string;
      readonly mediaId: string | null;
    }
  | { readonly outcome: "duplicate" };

export async function recordInboundProjectWhatsAppMessage(
  principal: DomainPrincipal,
  input: InboundWhatsAppMessage,
  db: TransactionalDomainDb,
): Promise<InboundProjectWhatsAppOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp webhook may record an inbound message.",
    );
  }
  const groupId = input.groupId?.trim();
  if (!groupId) {
    throw new DomainValidationError(
      "A project message must name its WhatsApp group.",
      "groupId",
    );
  }

  const { body, kind } = classifyInboundWhatsApp(input);
  const senderPhoneE164 =
    waIdToE164(input.fromWaId) ?? `+${input.fromWaId.replace(/\D/g, "")}`;
  const senderName = input.profileName?.trim() || null;
  const media = input.media
    ? { media: { create: whatsappMediaCreateData(input.media) } }
    : {};

  try {
    return await db.$transaction(async (tx) => {
      if (await alreadyRecorded(tx, input.providerMessageId)) {
        return { outcome: "duplicate" as const };
      }

      const group = await tx.projectWhatsAppGroup.findUnique({
        select: {
          id: true,
          lastMessageAt: true,
          projectId: true,
          status: true,
        },
        where: { providerGroupId: groupId },
      });

      if (!group || group.status === ProjectWhatsAppGroupStatus.DELETED) {
        const unmatched = await tx.whatsAppUnmatchedMessage.create({
          data: {
            body,
            businessPhoneNumberId: input.businessPhoneNumberId,
            candidateLeadIds: [],
            fromPhoneE164: senderPhoneE164,
            kind,
            profileName: senderName,
            providerGroupId: groupId,
            providerMessageId: input.providerMessageId,
            reason: WhatsAppUnmatchedReason.UNLINKED_GROUP,
            receivedAt: input.sentAt,
            ...media,
          },
          select: { id: true, media: { select: { id: true } } },
        });
        return {
          mediaId: unmatched.media?.id ?? null,
          outcome: "unlinked" as const,
          unmatchedId: unmatched.id,
        };
      }

      const message = await tx.projectWhatsAppMessage.create({
        data: {
          body,
          direction: WhatsAppMessageDirection.INBOUND,
          groupId: group.id,
          kind,
          occurredAt: input.sentAt,
          projectId: group.projectId,
          providerMessageId: input.providerMessageId,
          senderName,
          senderPhoneE164,
          senderWaId: input.fromWaId,
          status: WhatsAppMessageStatus.RECEIVED,
          statusAt: input.sentAt,
          ...media,
        },
        select: { id: true, media: { select: { id: true } } },
      });

      // A retried delivery from days ago must not move "last message" back.
      const lastMessageAt =
        group.lastMessageAt && group.lastMessageAt > input.sentAt
          ? group.lastMessageAt
          : input.sentAt;
      await tx.projectWhatsAppGroup.update({
        data: { lastMessageAt, unreadCount: { increment: 1 } },
        where: { id: group.id },
      });

      // Someone who writes is in the group, whether or not the join webhook
      // reached us.
      await tx.projectWhatsAppParticipant.upsert({
        create: {
          groupId: group.id,
          joinedAt: input.sentAt,
          phoneE164: senderPhoneE164,
          waId: input.fromWaId,
        },
        update: {},
        where: { groupId_waId: { groupId: group.id, waId: input.fromWaId } },
      });

      return {
        mediaId: message.media?.id ?? null,
        messageId: message.id,
        outcome: "attached" as const,
        projectId: group.projectId,
      };
    });
  } catch (error) {
    // Two deliveries of one message at once: the loser hits the unique wamid.
    // Only a duplicate once the winner's row is really there — see the lead
    // inbound for why anything else is rethrown.
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
    db.projectWhatsAppMessage.findUnique({
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
