import { OfferStatus, Prisma, type Offer } from "@prisma/client";

import { authorizeLead } from "../access/leads";
import type { TransactionalDomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";

// A lead's first offer: minting its reference and creating the row.
//
// This was the app's offer page, and only the app's: the page created the row
// on first open, and nothing else could. Eve could edit an offer but never
// start one. Both now come through `openOfferForLead`, so the reference
// sequence, the creator and the opening status are decided once.
//
// The row is created empty. What the offer contains is a workspace save, which
// goes through lib/domain/offers/workspace-save.ts like any other: the screen
// seeds it in the browser, and Eve saves lib/offer/initial-workspace.ts's
// snapshot through the same command.

/** Mint the next base reference (RC-Q-YYYY-NNN) inside a transaction. */
export async function mintOfferReference(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.offerReferenceCounter.upsert({
    where: { year },
    create: { year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return `RC-Q-${year}-${String(counter.lastSeq).padStart(3, "0")}`;
}

export type OpenOfferOutcome = {
  readonly offer: Offer;
  /** True when this call created the lead's first offer. */
  readonly created: boolean;
};

function findActiveOffer(leadId: number, db: TransactionalDomainDb) {
  return db.offer.findFirst({
    where: { leadId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * The lead's live offer, creating its first one if it has none.
 *
 * A second create for the same lead — a double-click, two tabs opening the
 * offer at once — loses on the one-active-offer-per-lead index and is answered
 * with the offer the first one made, rather than a database error.
 */
export async function openOfferForLead(
  principal: DomainPrincipal,
  input: { readonly leadId: number },
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<OpenOfferOutcome> {
  await authorizeLead(principal, input.leadId, db);

  const existing = await findActiveOffer(input.leadId, db);
  if (existing) return { created: false, offer: existing };

  const createdById = attributionUserId(principal);
  if (createdById === null) {
    throw new DomainAuthorizationError(
      "Starting an offer needs a signed-in team member to own it.",
    );
  }

  try {
    const offer = await db.$transaction(async (tx) => {
      const baseReference = await mintOfferReference(tx, now.getFullYear());
      return tx.offer.create({
        data: {
          leadId: input.leadId,
          baseReference,
          revisionNumber: 1,
          isActive: true,
          createdById,
          offerStatus: OfferStatus.PENDING,
          amount: new Prisma.Decimal(0),
          gstAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(0),
        },
      });
    });
    return { created: true, offer };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      const winner = await findActiveOffer(input.leadId, db);
      if (winner) return { created: false, offer: winner };
    }
    throw error;
  }
}
