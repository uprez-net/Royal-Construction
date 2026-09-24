import type { OfferStatus, Prisma } from "@prisma/client";

import { authorizeLead } from "../access/leads";
import type { DomainDb } from "../db";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { CHANGE_REQUEST_PREFIX } from "@/lib/offer/offer-activity-marker";
import { getAllEmailThreads } from "@/utils/email-parser";
import {
  parseOfferReplyAttachments,
  type OfferReplyAttachment,
} from "./replies";

export type OfferActivityResult = {
  readonly ok: true;
  readonly sends: readonly {
    readonly recipientEmail: string;
    readonly offerFileVersion: number;
    readonly sentAt: string;
    readonly openedAt: string | null;
    readonly repliedAt: string | null;
    readonly lastReplyAt: string | null;
    readonly replies: readonly OfferActivityReply[];
  }[];
  readonly events: readonly {
    readonly fromStatus: OfferStatus | null;
    readonly toStatus: OfferStatus;
    readonly note: string | null;
    readonly at: string;
  }[];
};

/** One recorded client reply to a send, oldest first under its send. */
export type OfferActivityReply = {
  readonly fromEmail: string;
  readonly subject: string;
  readonly receivedAt: string;
  /** What the client wrote in this message, with the quoted thread cut off. */
  readonly text: string;
  /** The whole body, quoted history included. Null when it is just `text`. */
  readonly fullText: string | null;
  readonly attachments: readonly OfferReplyAttachment[];
};

export async function loadOfferActivity(
  principal: DomainPrincipal,
  leadId: number,
  db: DomainDb,
): Promise<OfferActivityResult> {
  await authorizeLead(principal, leadId, db);
  const offer = await db.offer.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
    where: { isActive: true, leadId },
  });
  if (!offer) return { events: [], ok: true, sends: [] };

  const [sends, events] = await Promise.all([
    db.offerDocumentSend.findMany({
      orderBy: { sentAt: "desc" },
      select: {
        lastReplyAt: true,
        offerFileVersion: true,
        openedAt: true,
        recipientEmail: true,
        repliedAt: true,
        sentAt: true,
        replies: {
          orderBy: { receivedAt: "asc" },
          select: {
            attachments: true,
            body: true,
            fromEmail: true,
            receivedAt: true,
            subject: true,
          },
        },
      },
      where: { offerId: offer.id },
    }),
    db.offerStatusEvent.findMany({
      orderBy: { at: "desc" },
      select: { at: true, fromStatus: true, note: true, toStatus: true },
      where: { offerId: offer.id },
    }),
  ]);
  return {
    events: events.map((event) => ({
      ...event,
      at: event.at.toISOString(),
    })),
    ok: true,
    sends: sends.map((send) => ({
      ...send,
      lastReplyAt: send.lastReplyAt?.toISOString() ?? null,
      openedAt: send.openedAt?.toISOString() ?? null,
      repliedAt: send.repliedAt?.toISOString() ?? null,
      replies: send.replies.map(toActivityReply),
      sentAt: send.sentAt.toISOString(),
    })),
  };
}

function toActivityReply(reply: {
  readonly attachments: Prisma.JsonValue;
  readonly body: string;
  readonly fromEmail: string;
  readonly receivedAt: Date;
  readonly subject: string;
}): OfferActivityReply {
  // Graph's text rendering is CRLF and the splitter's output is not; without
  // this, every reply would differ from its own "full" text.
  const fullText = reply.body.replace(/\r\n?/g, "\n").trim();
  // getAllEmailThreads returns newest first, so [0] is what the client wrote
  // in this message and the rest is our own offer email quoted back. A split
  // that finds nothing falls back to the whole body rather than an empty one.
  const text = getAllEmailThreads(fullText)[0]?.body.trim() || fullText;
  return {
    attachments: parseOfferReplyAttachments(reply.attachments),
    fromEmail: reply.fromEmail,
    fullText: text === fullText ? null : fullText,
    receivedAt: reply.receivedAt.toISOString(),
    subject: reply.subject,
    text,
  };
}

export async function logOfferChangeRequest(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly note: string },
  db: DomainDb,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly error: string }
> {
  const note = input.note.trim();
  if (note.length === 0) {
    return { error: "Enter the change the customer requested.", ok: false };
  }
  await authorizeLead(principal, input.leadId, db);
  const offer = await db.offer.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, offerStatus: true },
    where: { isActive: true, leadId: input.leadId },
  });
  if (!offer) {
    return {
      error: "No active offer to log a change request against.",
      ok: false,
    };
  }
  await db.offerStatusEvent.create({
    data: {
      actorId: attributionUserId(principal),
      fromStatus: offer.offerStatus,
      note: `${CHANGE_REQUEST_PREFIX} ${note}`,
      offerId: offer.id,
      toStatus: offer.offerStatus,
    },
  });
  return { ok: true };
}

export async function recordOfferActivityEvent(
  principal: DomainPrincipal,
  input: {
    readonly fromStatus: OfferStatus;
    readonly note: string;
    readonly offerId: string;
    readonly toStatus: OfferStatus;
  },
  db: DomainDb,
): Promise<void> {
  await db.offerStatusEvent.create({
    data: {
      actorId: attributionUserId(principal),
      fromStatus: input.fromStatus,
      note: input.note,
      offerId: input.offerId,
      toStatus: input.toStatus,
    },
  });
}
