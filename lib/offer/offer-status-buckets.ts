import type { OfferStatus } from "@prisma/client";
import type { OfferStatusBucket } from "@/types/offer";

/**
 * Maps a filter tab to the set of `OfferStatus` values its representative
 * revision may be in. `all` is the absence of a status filter.
 *
 * The one list both the tab filter and the KPI counts read, so a lead lands in
 * the same bucket whether it is counted or filtered. They used to keep separate
 * copies, and neither had the acceptance-signing statuses. The buckets overlap
 * on purpose: TENDER_SENT is both sent and approved.
 */
export const OFFER_STATUS_BUCKETS: Readonly<
  Record<Exclude<OfferStatusBucket, "all">, readonly OfferStatus[]>
> = {
  pending: ["PENDING"],
  approved: [
    "ACCEPTED",
    // Every customer has signed the offer acceptance (ADR 0004).
    "OFFER_SIGNED",
    "AGREED",
    "TENDER_DRAFT",
    "TENDER_SENT",
    "TENDER_SIGNED",
    "CONTRACT_DRAFT",
    "CONTRACT_SENT",
    "CONTRACT_SIGNED",
    "PROJECT",
  ],
  rejected: [
    "REJECTED",
    "OFFER_DECLINED",
    "TENDER_DECLINED",
    "CONTRACT_DECLINED",
  ],
  // OFFER_SENT: the acceptance is out with the customer for signature.
  sent: ["SENT", "OFFER_SENT", "TENDER_SENT", "CONTRACT_SENT"],
};
