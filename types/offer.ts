import type {
  Offer,
  Lead,
  OfferItem,
  OfferStatus,
  OfferFile,
} from "@prisma/client";
import type { OfferFile as OfferFileType } from "@/types/offer-content";

// Progress shape for the offer/tender workflow status stream. Formerly exported
// from lib/workflow/offer.ts (removed with the old AI offer flow); relocated
// here so the kept WorkFlowStatusContext + resume-stream route compile. The
// project tender-extraction stream reuses the same context/route.
export interface OfferCreationStatus {
  failed?: boolean;
  status:
    | "FETCHING_DETAILS"
    | "BUILDING_OFFER"
    | "SAVING_OFFER"
    | "TRIGGERING_NOTIFICATION"
    | "COMPLETED";
  progress: number;
  message: {
    step:
      | "FETCHING_DETAILS"
      | "BUILDING_OFFER"
      | "SAVING_OFFER"
      | "TRIGGERING_NOTIFICATION"
      | "COMPLETED";
    details?: string;
  }[];
}

export interface SafeOfferItem extends Omit<
  OfferItem,
  "unitPrice" | "totalPrice"
> {
  unitPrice: string;
  totalPrice: string;
}

export interface SafeOfferDBFile extends Omit<OfferFile, "offerContent"> {
  offerContent: OfferFileType;
}

// Every Prisma Decimal on Offer is narrowed to string here. Decimal is not a
// plain object, so leaving one on this type lets it reach a Client Component and
// trip React's "Only plain objects can be passed to Client Components" warning —
// which is what contractValueIncGst did before it was added to this Omit.
export interface SafeOffer extends Omit<
  Offer,
  "amount" | "gstAmount" | "totalAmount" | "contractValueIncGst"
> {
  amount: string;
  gstAmount: string;
  totalAmount: string;
  // Nullable in the schema — an offer has no contract value until it is priced.
  contractValueIncGst: string | null;
  version: number;
}

/** The lead columns the offers listing selects: only what the table renders. */
export type OfferListLead = Pick<
  Lead,
  "id" | "name" | "email" | "phone" | "location" | "type"
>;

export interface OfferWithLead extends SafeOffer {
  lead: OfferListLead;
}

/** One revision as the offers listing sends it to the browser (see toOfferListRow). */
export type OfferListRow = Pick<
  SafeOffer,
  | "id"
  | "leadId"
  | "baseReference"
  | "revisionNumber"
  | "isActive"
  | "offerStatus"
  | "amount"
  | "gstAmount"
  | "totalAmount"
  | "contractValueIncGst"
  | "sentAt"
  | "acceptedAt"
  | "createdAt"
  | "updatedAt"
  | "version"
>;

export interface OfferWithItemsAndFiles extends OfferWithLead {
  items: Record<number, SafeOfferItem[]>;
  files: Record<number, SafeOfferDBFile>;
}

export type PaginatedOfferResult = {
  items: OfferWithLead[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

/**
 * One lead's whole revision family, collapsed into a single table row.
 *
 * An offer is unique per lead: every re-price creates another `Offer` row in the
 * same revision family (ADR 0002), so a flat `Offer` listing repeats the same
 * client once per revision. The offers table paginates over these groups, not
 * over `Offer` rows.
 */
export interface OfferGroup {
  leadId: number;
  lead: OfferListLead;
  /** `baseReference` of the representative offer, or a `OF-<leadId>` fallback. */
  reference: string;
  /**
   * The revision the group speaks for: the active one, else the highest
   * revision number. Its status/amounts drive the collapsed row.
   */
  latest: OfferListRow;
  /** Every revision in the family, newest first. Always includes `latest`. */
  revisions: OfferListRow[];
  versionCount: number;
}

export type PaginatedOfferGroupResult = {
  items: OfferGroup[];
  page: number;
  limit: number;
  /** Leads with at least one offer — what the page count is derived from. */
  totalCount: number;
  /** Individual revisions across those leads. Only shown as a caption. */
  totalOfferCount: number;
  totalPages: number;
};

export interface KPIResult {
  total: number;
  trendDelta: number;
}

export interface OfferKPIs {
  /** Offer revisions across every lead — the KPI totals count leads, not revisions. */
  totalVersions: number;
  allOffers: KPIResult;
  /**
   * Leads whose offer is not in the rejected bucket: what the table's "All"
   * tab lists and counts (issue #450). `allOffers` stays the true total for
   * the Total Offers card.
   */
  openOffers: number;
  pendingOffers: KPIResult;
  approvedOffers: KPIResult;
  rejectedOffers: KPIResult;
  sentOffers: KPIResult;
}

/**
 * The tab/filter buckets the offers table paginates by. These are *not*
 * individual `OfferStatus` values: the offer lifecycle introduced terminal
 * states (AGREED, TENDER_*, CONTRACT_*, PROJECT, *_DECLINED) that the old
 * single-status tabs silently dropped. The table filter and the KPI query both
 * read their status sets from `OFFER_STATUS_BUCKETS`, so a lead whose
 * representative revision is `TENDER_SIGNED` counts (and filters) as "approved"
 * in both. Buckets overlap by design — `TENDER_SENT` is both "sent" and
 * "approved".
 */
export type OfferStatusBucket =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "sent";

export const OfferStatusLabels: Record<OfferStatus, string> = {
  PENDING: "Pending",
  ACCEPTED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  OFFER_SENT: "Acceptance sent",
  OFFER_SIGNED: "Accepted",
  OFFER_DECLINED: "Acceptance declined",
  AGREED: "Agreed",
  TENDER_DRAFT: "Tender draft",
  TENDER_SENT: "Tender sent",
  TENDER_SIGNED: "Tender signed",
  TENDER_DECLINED: "Tender declined",
  CONTRACT_DRAFT: "Contract draft",
  CONTRACT_SENT: "Contract sent",
  CONTRACT_SIGNED: "Contract signed",
  CONTRACT_DECLINED: "Contract declined",
  PROJECT: "Project",
  SUPERSEDED: "Superseded",
};
