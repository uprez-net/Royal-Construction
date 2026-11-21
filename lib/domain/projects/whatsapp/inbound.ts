import {
  ProjectWhatsAppGroupStatus,
  WhatsAppMediaSource,
  WhatsAppMediaStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError, DomainValidationError } from "../../errors";
import type { DomainPrincipal } from "../../principal";
import { unsupportedWhatsAppBody } from "../../leads/whatsapp/inbound";
import { isUniqueViolation } from "../../leads/whatsapp/records";
import {
  whatsappMediaBody,
  whatsappMediaCreateData,
  type InboundWhatsAppMedia,
} from "../../whatsapp/media";
import { GROUP_CREATE_DEADLINE_MS } from "./group-shared";

// A message posted in a project's WhatsApp group, arriving from the bridge.
//
// The same promises as a lead's inbound message: never stored twice — the
// bridge redelivers until the app answers, and WhatsApp's message id is
// unique — and never dropped for a group the project has:
//
//   - a group still being set up (created, or a link being claimed) has its
//     messages HELD: the app answers "try again" and the bridge redelivers
//     once the group is saved, so the first seconds of a new group are kept;
//   - a group the app has no live link for means the two disagree: reported,
//     not filed, and the next resync tells the bridge to stop;
//   - a message the bridge queued for one project is never filed on another
//     after the group was relinked;
//   - a message sent before the group was linked is not imported.
//
// Royal's own number writing in the group from the phone arrives here too
// (`fromMe`), so the project's thread shows the whole conversation.

export type InboundProjectWhatsAppMessage = {
  readonly groupJid: string;
  /** The project the bridge forwarded it for. Checked against the link. */
  readonly projectId: string;
  /** WhatsApp's message id. */
  readonly providerMessageId: string;
  /** Royal's own number wrote it, on the phone rather than through the app. */
  readonly fromMe: boolean;
  readonly senderJid: string;
  readonly senderPhoneE164: string | null;
  readonly senderName: string | null;
  readonly sentAt: Date;
  readonly text: string;
  /** The attachment, with `providerMediaId` set to the bridge's message id. */
  readonly media:
    | (InboundWhatsAppMedia & {
        /** Null when the bridge has the file to fetch; otherwise why not. */
        readonly unavailableReason: string | null;
      })
    | null;
  /** For a message type the app does not show, WhatsApp's name for it. */
  readonly unsupportedType: string | null;
};

export type InboundProjectWhatsAppOutcome =
  | {
      readonly outcome: "attached";
      readonly projectId: string;
      readonly messageId: string;
      /** A file now waiting to be copied into storage. */
      readonly mediaId: string | null;
    }
  | { readonly outcome: "unknown_group" }
  /** The group is still being saved: not recorded, ask the bridge to retry. */
  | { readonly outcome: "group_pending" }
  /** Queued for another project than the group's link now: not filed. */
  | { readonly outcome: "project_mismatch" }
  /** Sent before the group was linked: not imported. */
  | { readonly outcome: "before_link" }
  | { readonly outcome: "duplicate" };

/** Phones' clocks drift; a message this close to the link still counts. */
const LINK_CLOCK_GRACE_MS = 2 * 60 * 1000;

function classify(input: InboundProjectWhatsAppMessage): {
  kind: WhatsAppMessageKind;
  body: string;
} {
  if (input.media) {
    return {
      body: whatsappMediaBody(input.media),
      kind: WhatsAppMessageKind.MEDIA,
    };
  }
  const text = input.text.trim();
  if (text) return { body: text, kind: WhatsAppMessageKind.TEXT };
  return {
    body: unsupportedWhatsAppBody(input.unsupportedType ?? ""),
    kind: WhatsAppMessageKind.UNSUPPORTED,
  };
}

export async function recordInboundProjectWhatsAppMessage(
  principal: DomainPrincipal,
  input: InboundProjectWhatsAppMessage,
  db: TransactionalDomainDb,
): Promise<InboundProjectWhatsAppOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp bridge webhook may record an inbound message.",
    );
  }
  const groupJid = input.groupJid.trim();
  if (!groupJid) {
    throw new DomainValidationError(
      "A project message must name its WhatsApp group.",
      "groupJid",
    );
  }

  const { body, kind } = classify(input);
  const senderName = input.senderName?.trim() || null;
  const media = input.media
    ? {
        media: {
          create: {
            ...whatsappMediaCreateData(input.media),
            // Fetched from the bridge by message id, never from Meta.
            source: WhatsAppMediaSource.BRIDGE,
            // The bridge could not download it (too large, or WhatsApp
            // refused): recorded as failed with the reason, never retried
            // into the same answer.
            ...(input.media.unavailableReason
              ? {
                  failureReason: input.media.unavailableReason,
                  status: WhatsAppMediaStatus.FAILED,
                }
              : {}),
          },
        },
      }
    : {};

  try {
    return await db.$transaction(async (tx) => {
      if (await alreadyRecorded(tx, input.providerMessageId)) {
        return { outcome: "duplicate" as const };
      }

      const group = await tx.projectWhatsAppGroup.findUnique({
        select: {
          createdAt: true,
          id: true,
          lastMessageAt: true,
          linkedAt: true,
          projectId: true,
          status: true,
        },
        where: { providerGroupId: groupJid },
      });
      const fresh = (createdAt: Date) =>
        Date.now() - createdAt.getTime() < GROUP_CREATE_DEADLINE_MS;
      if (!group) {
        // A group just created: the bridge knows its id before the app does.
        const pending = await tx.projectWhatsAppGroup.findUnique({
          select: { createdAt: true, status: true },
          where: { projectId: input.projectId },
        });
        return pending?.status === ProjectWhatsAppGroupStatus.CREATING
          && fresh(pending.createdAt)
          ? { outcome: "group_pending" as const }
          : { outcome: "unknown_group" as const };
      }
      if (
        group.status === ProjectWhatsAppGroupStatus.CREATING
        && fresh(group.createdAt)
      ) {
        return { outcome: "group_pending" as const };
      }
      if (group.status !== ProjectWhatsAppGroupStatus.ACTIVE) {
        return { outcome: "unknown_group" as const };
      }
      if (group.projectId !== input.projectId) {
        return { outcome: "project_mismatch" as const };
      }
      if (
        group.linkedAt
        && input.sentAt.getTime()
          < group.linkedAt.getTime() - LINK_CLOCK_GRACE_MS
      ) {
        return { outcome: "before_link" as const };
      }

      const message = await tx.projectWhatsAppMessage.create({
        data: {
          body,
          direction: input.fromMe
            ? WhatsAppMessageDirection.OUTBOUND
            : WhatsAppMessageDirection.INBOUND,
          groupId: group.id,
          kind,
          occurredAt: input.sentAt,
          projectId: group.projectId,
          providerMessageId: input.providerMessageId,
          senderName,
          senderPhoneE164: input.senderPhoneE164,
          senderWaId: input.senderJid,
          status: input.fromMe
            ? WhatsAppMessageStatus.SENT
            : WhatsAppMessageStatus.RECEIVED,
          statusAt: input.sentAt,
          ...media,
        },
        select: {
          id: true,
          media: { select: { id: true, status: true } },
        },
      });

      // A redelivery from days ago must not move "last message" back.
      const lastMessageAt =
        group.lastMessageAt && group.lastMessageAt > input.sentAt
          ? group.lastMessageAt
          : input.sentAt;
      await tx.projectWhatsAppGroup.update({
        data: {
          lastMessageAt,
          // The office's own words from the phone are not something to read.
          ...(input.fromMe ? {} : { unreadCount: { increment: 1 } }),
        },
        where: { id: group.id },
      });

      // Someone who writes is in the group, whether or not the join event
      // reached us.
      if (!input.fromMe) {
        await tx.projectWhatsAppParticipant.upsert({
          create: {
            groupId: group.id,
            joinedAt: input.sentAt,
            phoneE164: input.senderPhoneE164,
            waId: input.senderJid,
          },
          update: input.senderPhoneE164
            ? { phoneE164: input.senderPhoneE164 }
            : {},
          where: { groupId_waId: { groupId: group.id, waId: input.senderJid } },
        });
      }

      return {
        mediaId:
          message.media?.status === WhatsAppMediaStatus.PENDING
            ? message.media.id
            : null,
        messageId: message.id,
        outcome: "attached" as const,
        projectId: group.projectId,
      };
    });
  } catch (error) {
    // Two deliveries of one message at once: the loser hits the unique id.
    // Only a duplicate once the winner's row is really there.
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
  const message = await db.projectWhatsAppMessage.findUnique({
    select: { id: true },
    where: { providerMessageId },
  });
  return Boolean(message);
}
