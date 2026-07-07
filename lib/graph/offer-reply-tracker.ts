import prisma from "@/lib/prisma";
import type { GraphMessage } from "./client";

// Offer emails carry "[RCOFR-<12 hex>]" in the subject; replies keep it as
// "Re: … [RCOFR-…]", letting us correlate an inbound message to the send.
const OFFER_TOKEN_RE = /\[(RCOFR-[0-9A-Fa-f]{12})\]/;

export function extractOfferReplyToken(
  subject: string | undefined | null,
): string | null {
  if (!subject) {
    return null;
  }
  const match = OFFER_TOKEN_RE.exec(subject);
  return match ? match[1].toUpperCase() : null;
}

// Record an inbound reply against its OfferDocumentSend. Idempotent: repliedAt
// is stamped once (first reply); lastReplyAt tracks the most recent. Returns
// false if the token doesn't match a known send.
export async function recordOfferReply(
  token: string,
  message: GraphMessage,
): Promise<boolean> {
  const send = await prisma.offerDocumentSend.findUnique({
    where: { trackedLinkToken: token },
    select: { id: true, repliedAt: true },
  });
  if (!send) {
    return false;
  }
  const receivedAt = message.receivedDateTime
    ? new Date(message.receivedDateTime)
    : new Date();
  await prisma.offerDocumentSend.update({
    where: { id: send.id },
    data: {
      lastReplyAt: receivedAt,
      ...(send.repliedAt ? {} : { repliedAt: receivedAt }),
    },
  });
  return true;
}
