import { EnvelopeStatus, OfferStatus, Prisma } from "@prisma/client";

import { authorizeOffer } from "../access/offers";
import type { TransactionalDomainDb } from "../db";
import type { EnvelopeControlPort } from "../ports/envelope-control";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { LIVE_ENVELOPE_STATUSES } from "@/lib/docusign/envelope-status";
import { resolveOfferPriceSplit } from "@/lib/offer/offer-contract-value";
import {
  decideRecallPullBack,
  describeUnconfirmedVoid,
  envelopeScopeFilter,
} from "@/lib/offer/offer-recall";
import { voidLiveOfferEnvelopes } from "./envelope-control";

const REVISION_LOCKED_STATUSES: ReadonlySet<OfferStatus> = new Set([
  OfferStatus.TENDER_SIGNED,
  OfferStatus.CONTRACT_DRAFT,
  OfferStatus.CONTRACT_SENT,
  OfferStatus.CONTRACT_DECLINED,
  OfferStatus.CONTRACT_SIGNED,
  OfferStatus.PROJECT,
]);

export type CreateOfferRevisionResult =
  | {
      readonly ok: true;
      readonly offerId: string;
      readonly leadId: number;
      readonly voidedEnvelopes: number;
      readonly voidWarnings: readonly string[];
    }
  | { readonly ok: false; readonly reason: "locked" }
  | { readonly ok: false; readonly reason: "refused"; readonly error: string };

/**
 * Fork the active revision after proving every live signing envelope is dead.
 *
 * The row lock and second live-envelope check close the one-person race that
 * matters here: one tab begins a revision while another tab sends the current
 * document. The fork either sees and refuses that send or becomes the only
 * active revision; it never silently leaves the client a signable superseded
 * document.
 */
export async function createOfferRevision(
  principal: DomainPrincipal,
  input: { readonly offerId: string },
  db: TransactionalDomainDb,
  envelopePort: EnvelopeControlPort,
): Promise<CreateOfferRevisionResult> {
  await authorizeOffer(principal, input.offerId, db);

  const current = await db.offer.findUnique({
    select: { offerStatus: true },
    where: { id: input.offerId },
  });
  if (!current || REVISION_LOCKED_STATUSES.has(current.offerStatus)) {
    return { ok: false, reason: "locked" };
  }

  const voids = await voidLiveOfferEnvelopes(db, envelopePort, {
    offerId: input.offerId,
    reason: "Superseded by a new revision of this offer.",
    scope: "all",
  });
  if (!decideRecallPullBack(voids).proceed) {
    return {
      error: describeUnconfirmedVoid({
        action: "revision",
        unsettled: voids.unsettled,
        voidedCount: voids.voidedIds.length,
      }),
      ok: false,
      reason: "refused",
    };
  }

  const created = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Offer" WHERE "id" = ${input.offerId} FOR UPDATE`,
    );
    if (locked.length === 0) return null;

    const row = await tx.offer.findUnique({ where: { id: input.offerId } });
    if (
      !row ||
      !row.isActive ||
      REVISION_LOCKED_STATUSES.has(row.offerStatus)
    ) {
      return null;
    }

    if (voids.voidedIds.length > 0) {
      await tx.envelope.updateMany({
        data: { status: EnvelopeStatus.VOIDED, voidedAt: new Date() },
        where: {
          id: { in: [...voids.voidedIds] },
          status: { in: LIVE_ENVELOPE_STATUSES },
        },
      });
    }

    const sentMeanwhile = await tx.envelope.count({
      where: {
        id: { notIn: [...voids.voidedIds, ...voids.endedIds] },
        OR: envelopeScopeFilter(input.offerId, "all"),
        status: { in: LIVE_ENVELOPE_STATUSES },
      },
    });
    if (sentMeanwhile > 0) return "sent-meanwhile" as const;

    await tx.offer.update({
      data: { isActive: false, offerStatus: OfferStatus.SUPERSEDED },
      where: { id: row.id },
    });

    const price = resolveOfferPriceSplit(
      row.contractValueIncGst === null ? null : Number(row.contractValueIncGst),
      row.workspaceState,
    );
    const next = await tx.offer.create({
      data: {
        amount: price?.amountExGst ?? row.amount,
        baseReference: row.baseReference,
        contractValueIncGst: price?.totalIncGst ?? row.contractValueIncGst,
        createdById: attributionUserId(principal),
        gstAmount: price?.gstAmount ?? row.gstAmount,
        isActive: true,
        leadId: row.leadId,
        offerStatus: OfferStatus.PENDING,
        revisionNumber: row.revisionNumber + 1,
        totalAmount: price?.totalIncGst ?? row.totalAmount,
        workspaceState:
          row.workspaceState === null
            ? Prisma.JsonNull
            : (row.workspaceState as Prisma.InputJsonValue),
      },
    });
    await tx.offer.update({
      data: { supersededById: next.id },
      where: { id: row.id },
    });
    return next;
  });

  if (created === "sent-meanwhile") {
    return {
      error:
        "No revision was created: a document on this offer was sent for signature while the revision was being prepared. Refresh and try again.",
      ok: false,
      reason: "refused",
    };
  }
  if (!created) return { ok: false, reason: "locked" };

  return {
    leadId: created.leadId,
    offerId: created.id,
    ok: true,
    voidedEnvelopes: voids.voidedIds.length,
    voidWarnings: [],
  };
}
