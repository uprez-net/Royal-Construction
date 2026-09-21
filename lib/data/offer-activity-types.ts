import type { OfferStatus } from "@prisma/client";
export { CHANGE_REQUEST_PREFIX } from "@/lib/offer/offer-activity-marker";

// Shared types + constant for the offer negotiation activity (ADR 0004). Kept
// OUT of offer-activity.ts because a "use server" module may only export async
// server actions — not consts or types (a Next.js bundler rule).

// The "Change request:" prefix marks an OfferStatusEvent that is a logged customer
// change request (a note, not a transition — fromStatus == toStatus) rather than a
// lifecycle change. Shared so the writer and any reader agree on the marker.
export type OfferActivitySend = {
  readonly recipientEmail: string;
  readonly offerFileVersion: number;
  readonly sentAt: string;
  readonly openedAt: string | null;
  readonly repliedAt: string | null;
  readonly lastReplyAt: string | null;
};

export type OfferActivityEvent = {
  readonly fromStatus: OfferStatus | null;
  readonly toStatus: OfferStatus;
  readonly note: string | null;
  readonly at: string;
};

export type OfferActivity =
  | {
      ok: true;
      sends: readonly OfferActivitySend[];
      events: readonly OfferActivityEvent[];
    }
  | { ok: false; error: string };
