"use server";

import prisma from "@/lib/prisma";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
// A "use server" module may only export async server actions, so the const + types
// live in a plain module (ADR 0004).
import {
  CHANGE_REQUEST_PREFIX,
  type OfferActivity,
} from "@/lib/data/offer-activity-types";

// The negotiation activity for a lead's active offer: each Offer-document send with
// its open/reply telemetry (OfferDocumentSend) and each lifecycle event
// (OfferStatusEvent — signing transitions, plus logged change requests). Read-only;
// surfaced on the Send & negotiate step so the email back-and-forth (which happens
// off-system, in the builder's mailbox) is at least visible in-app (ADR 0004).
export async function loadOfferActivity(input: {
  leadId: number;
}): Promise<OfferActivity> {
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const offer = await prisma.offer.findFirst({
    where: { leadId: input.leadId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!offer) {
    return { ok: true, sends: [], events: [] };
  }
  const [sends, events] = await Promise.all([
    prisma.offerDocumentSend.findMany({
      where: { offerId: offer.id },
      orderBy: { sentAt: "desc" },
      select: {
        recipientEmail: true,
        offerFileVersion: true,
        sentAt: true,
        openedAt: true,
        repliedAt: true,
        lastReplyAt: true,
      },
    }),
    prisma.offerStatusEvent.findMany({
      where: { offerId: offer.id },
      orderBy: { at: "desc" },
      select: { fromStatus: true, toStatus: true, note: true, at: true },
    }),
  ]);
  return {
    ok: true,
    sends: sends.map((send) => ({
      recipientEmail: send.recipientEmail,
      offerFileVersion: send.offerFileVersion,
      sentAt: send.sentAt.toISOString(),
      openedAt: send.openedAt ? send.openedAt.toISOString() : null,
      repliedAt: send.repliedAt ? send.repliedAt.toISOString() : null,
      lastReplyAt: send.lastReplyAt ? send.lastReplyAt.toISOString() : null,
    })),
    events: events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      at: event.at.toISOString(),
    })),
  };
}

// Log a customer change request captured off the email thread, so the negotiation
// substance is recorded in-app (ADR 0004). Stored as an OfferStatusEvent note with
// fromStatus == toStatus (the current status) — an audit note, not a transition.
export async function logOfferChangeRequest(input: {
  leadId: number;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = input.note.trim();
  if (note.length === 0) {
    return { ok: false, error: "Enter the change the customer requested." };
  }
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const offer = await prisma.offer.findFirst({
    where: { leadId: input.leadId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, offerStatus: true },
  });
  if (!offer) {
    return { ok: false, error: "No active offer to log a change request against." };
  }
  await prisma.offerStatusEvent.create({
    data: {
      offerId: offer.id,
      fromStatus: offer.offerStatus,
      toStatus: offer.offerStatus,
      note: `${CHANGE_REQUEST_PREFIX} ${note}`,
      actorId: access.user.id,
    },
  });
  return { ok: true };
}
