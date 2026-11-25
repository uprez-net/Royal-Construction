import type { DomainDb } from "../db";
import { resolveOfferPriceSplit } from "@/lib/offer/offer-contract-value";
import {
  describeStalePriceText,
  findStalePriceText,
} from "@/lib/offer/stale-price-text";
import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";

/**
 * The refusal to send this offer while its text quotes an earlier revision's
 * total, or null when it is clean (#589). A first revision has nothing earlier
 * to be stale against.
 *
 * "Earlier" is every other offer on the same lead and base reference: the
 * revisions of this one. What counts as current is the price the documents
 * themselves print, which is derived from the workspace, so an offer whose
 * price has not moved is never flagged.
 */
export async function stalePriceTextRefusal(
  db: DomainDb,
  offerId: string,
  snapshot: OfferWorkspaceSnapshot,
): Promise<string | null> {
  const offer = await db.offer.findUnique({
    select: {
      baseReference: true,
      contractValueIncGst: true,
      leadId: true,
      workspaceState: true,
    },
    where: { id: offerId },
  });
  if (!offer) return null;

  const others = await db.offer.findMany({
    select: { amount: true, contractValueIncGst: true, totalAmount: true },
    where: {
      baseReference: offer.baseReference,
      id: { not: offerId },
      leadId: offer.leadId,
    },
  });
  if (others.length === 0) return null;

  const price = resolveOfferPriceSplit(
    offer.contractValueIncGst === null
      ? null
      : Number(offer.contractValueIncGst),
    offer.workspaceState,
  );
  const current = [
    price?.amountExGst,
    price?.totalIncGst,
    Number(offer.contractValueIncGst ?? 0),
  ].filter((value): value is number => typeof value === "number" && value > 0);
  const superseded = others.flatMap((other) =>
    [other.amount, other.totalAmount, other.contractValueIncGst]
      .filter((value) => value !== null)
      .map((value) => Number(value)),
  );

  const findings = findStalePriceText(snapshot, superseded, current);
  return findings.length === 0 ? null : describeStalePriceText(findings);
}
