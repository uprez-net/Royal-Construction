import { formatSydneyDate } from "@/lib/dates/sydney";

/**
 * The draft "Do follow-up" opens (issue #449): addressed to the client, naming
 * the site and the day the offer went out, and asking politely for a review.
 *
 * Only a starting point. The administrator edits it before anything is sent,
 * and what they send is what is recorded, so nothing here is a promise to the
 * client the office has not read first.
 */
export type OfferFollowUpDraftInput = {
  readonly clientName: string;
  readonly projectAddress: string | null;
  /** ISO instant the offer was first sent. */
  readonly sentAt: string;
  readonly reference: string;
  /** Who signs it; "Royal Constructions" alone when unknown. */
  readonly senderName?: string | null;
};

export type OfferFollowUpDraft = {
  readonly subject: string;
  readonly body: string;
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

export function offerFollowUpDraft(
  input: OfferFollowUpDraftInput,
): OfferFollowUpDraft {
  const address = input.projectAddress?.trim() || null;
  const sentOn = formatSydneyDate(new Date(input.sentAt));
  const sender = input.senderName?.trim();

  const subject = address
    ? `Following up on your offer for ${address}`
    : "Following up on your Royal Constructions offer";

  const body = [
    `Hi ${firstName(input.clientName)},`,
    `I hope you're well. I'm following up on the offer we sent you on ${sentOn}${address ? ` for ${address}` : ""} (reference ${input.reference}).`,
    "When you have a moment, could you please review the offer and let us know how you'd like to proceed? If anything is unclear, or you'd like to change something, we're very happy to talk it through.",
    "We look forward to hearing from you as soon as you're able.",
    sender
      ? `Kind regards,\n${sender}\nRoyal Constructions`
      : "Kind regards,\nRoyal Constructions",
  ].join("\n\n");

  return { subject, body };
}
