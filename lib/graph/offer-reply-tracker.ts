import prisma from "@/lib/prisma";
import { normalizeEmailAddress } from "@/utils/formatters";
import { isMachineGenerated } from "./offer-reply-classify";
import type { GraphMessage } from "./client";

export { extractOfferReplyToken } from "./offer-reply-classify";

export type OfferReplyOutcome =
  | "recorded"
  | "no-matching-send"
  | "auto-generated"
  | "sender-mismatch";

// Record an inbound reply against its OfferDocumentSend. Idempotent: repliedAt
// is stamped once (first reply); lastReplyAt tracks the most recent.
//
// Only a message genuinely sent BY the address we sent TO counts. A reply from
// an alias is therefore missed, which is the intended trade: repliedAt is the
// one signal that can ever prove the client received the offer, so a false
// negative (invisible) beats a false positive (actively wrong). Before this
// guard existed, a bounce stamped repliedAt — recording "the client replied"
// for an offer that never arrived.
export async function recordOfferReply(
  token: string,
  message: GraphMessage,
): Promise<OfferReplyOutcome> {
  const send = await prisma.offerDocumentSend.findUnique({
    where: { trackedLinkToken: token },
    select: { id: true, repliedAt: true, recipientEmail: true },
  });
  if (!send) {
    return "no-matching-send";
  }

  if (isMachineGenerated(message.headers)) {
    return "auto-generated";
  }

  const sender = normalizeEmailAddress(message.from ?? "");
  const recipient = normalizeEmailAddress(send.recipientEmail);
  if (!sender || !recipient || sender !== recipient) {
    return "sender-mismatch";
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
  return "recorded";
}
