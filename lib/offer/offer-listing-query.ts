import type { OfferStatus, Prisma } from "@prisma/client";
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

// Lead ids and revision numbers are Postgres int4; a longer number typed into
// search must not reach Prisma, which rejects an out-of-range Int instead of
// matching nothing.
const MAX_INT4 = 2_147_483_647;

function toInt4(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= MAX_INT4 ? value : null;
}

/**
 * The OR'd search terms for the offers listing. `q` is already trimmed.
 *
 * The listing shows each lead by its offer reference, but only the lead's own
 * columns were searched, so pasting the reference a client quoted found
 * nothing. It also matches every revision's baseReference, and the `OF-<id>`
 * fallback the table shows for a lead whose offer has none.
 */
export function offerSearchClauses(q: string): Prisma.LeadWhereInput[] {
  const clauses: Prisma.LeadWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
    { phone: { contains: q, mode: "insensitive" } },
    { location: { contains: q, mode: "insensitive" } },
    { offers: { some: { baseReference: { contains: q, mode: "insensitive" } } } },
  ];

  // Every PDF, email and envelope quotes the revision's full reference,
  // `${baseReference}-R${revisionNumber}`, and only the base is stored, so the
  // reference a client actually quotes never matched the clause above.
  const revisionReference = /^(.+)-R(\d+)$/i.exec(q);
  if (revisionReference) {
    const revisionNumber = toInt4(revisionReference[2]);
    if (revisionNumber !== null) {
      clauses.push({
        offers: {
          some: {
            baseReference: { contains: revisionReference[1], mode: "insensitive" },
            revisionNumber,
          },
        },
      });
    }
  }

  const fallbackReference = /^OF-(\d+)$/i.exec(q);
  if (fallbackReference) {
    const id = toInt4(fallbackReference[1]);
    if (id !== null) {
      clauses.push({ id });
    }
  }

  return clauses;
}
