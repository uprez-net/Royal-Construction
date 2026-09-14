import type { OfferStatus } from "@prisma/client";
import type { OfferListRow } from "@/types/offer";
import { resolveOfferPriceSplit } from "./offer-contract-value";

// Pure pieces of the offers listing query, kept free of Prisma and next/* so
// they can be unit-tested. lib/data/offer-listing.ts runs the queries.

type DecimalLike = { toString(): string };

/** The Offer columns the listing selects: what it renders, plus what the price repair reads. */
export type OfferListSource = {
  id: string;
  leadId: number;
  baseReference: string;
  revisionNumber: number;
  isActive: boolean;
  offerStatus: OfferStatus;
  amount: DecimalLike;
  gstAmount: DecimalLike;
  totalAmount: DecimalLike;
  contractValueIncGst: DecimalLike | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workspaceState: unknown;
};

export function toOfferListRow(
  offer: OfferListSource,
  version: number,
): OfferListRow {
  // Repair-on-read, mirroring resolveOfferContractValue's rationale.
  // These three columns were minted at zero and never written by the
  // workspace autosave, so every row saved before that fix carries a
  // $0 that never matched the document the client received, and no
  // migration can recompute it outside the workspace schema. A
  // positive stored total stays authoritative — it is what the save
  // recorded — so only unpriced rows are derived from their own
  // saved workspaceState.
  const storedTotal = Number(offer.totalAmount);
  const derived =
    storedTotal > 0
      ? null
      : resolveOfferPriceSplit(
          offer.contractValueIncGst === null
            ? null
            : Number(offer.contractValueIncGst),
          offer.workspaceState,
        );

  // Named fields, never a spread. This row is serialized to the browser, and
  // spreading the Offer shipped every revision's workspaceState and
  // agreedSnapshot to a table that renders neither.
  return {
    id: offer.id,
    leadId: offer.leadId,
    baseReference: offer.baseReference,
    revisionNumber: offer.revisionNumber,
    isActive: offer.isActive,
    offerStatus: offer.offerStatus,
    amount: (derived?.amountExGst ?? offer.amount).toString(),
    gstAmount: (derived?.gstAmount ?? offer.gstAmount).toString(),
    totalAmount: (derived?.totalIncGst ?? offer.totalAmount).toString(),
    contractValueIncGst:
      derived?.totalIncGst.toString() ??
      offer.contractValueIncGst?.toString() ??
      null,
    sentAt: offer.sentAt,
    acceptedAt: offer.acceptedAt,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    version,
  };
}
