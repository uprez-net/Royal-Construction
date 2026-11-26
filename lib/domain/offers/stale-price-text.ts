import type { DomainDb } from "../db";
import { resolveOfferPriceSplit } from "@/lib/offer/offer-contract-value";
import {
  describeStalePriceText,
  findStalePriceText,
} from "@/lib/offer/stale-price-text";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";

const dollars = (input: string): number => {
  const value = Number(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
};

/** The standard price an offer's saved workspace carries, or 0 if unreadable. */
function standardPrice(workspaceState: unknown): number {
  if (workspaceState === null || workspaceState === undefined) return 0;
  try {
    return dollars(
      deserializeWorkspace(parseWorkspaceState(workspaceState))
        .standardPriceInput,
    );
  } catch {
    return 0;
  }
}

/**
 * The refusal to send this offer while its text quotes an earlier revision's
 * total, or null when it is clean (#589). A first revision has nothing earlier
 * to be stale against.
 *
 * "Earlier" is every other offer on the same lead and base reference: the
 * revisions of this one, by contract total (inc or ex GST) and by standard
 * price. What counts as current is what the documents themselves print, which
 * is derived from the workspace, plus this offer's own standard price: a
 * standard price that was kept is not stale just because an earlier total
 * happened to equal it. An offer whose price has not moved is never flagged.
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
    select: {
      amount: true,
      contractValueIncGst: true,
      totalAmount: true,
      workspaceState: true,
    },
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
    dollars(snapshot.standardPriceInput),
  ].filter((value): value is number => typeof value === "number" && value > 0);
  const superseded = others.flatMap((other) => [
    ...[other.amount, other.totalAmount, other.contractValueIncGst]
      .filter((value) => value !== null)
      .map((value) => Number(value)),
    standardPrice(other.workspaceState),
  ]);

  const findings = findStalePriceText(snapshot, superseded, current);
  return findings.length === 0 ? null : describeStalePriceText(findings);
}
