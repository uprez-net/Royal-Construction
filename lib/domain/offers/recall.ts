import type { OfferStatus } from "@prisma/client";

import { authorizeOffer } from "../access/offers";
import type { DomainDb } from "../db";
import type { EnvelopeControlPort } from "../ports/envelope-control";
import type { DomainPrincipal } from "../principal";
import {
  decideRecallPullBack,
  describeUnconfirmedVoid,
  resolveRecall,
} from "@/lib/offer/offer-recall";
import { commitOfferStatusTransition } from "./status";
import { voidLiveOfferEnvelopes } from "./envelope-control";

export async function recallOfferEnvelope(
  principal: DomainPrincipal,
  input: {
    readonly note?: string;
    readonly offerId: string;
    readonly scope: "offer" | "tender" | "contract";
    readonly toStatus: OfferStatus;
  },
  db: DomainDb,
  envelopePort: EnvelopeControlPort,
): Promise<
  | {
      readonly ok: true;
      readonly status: OfferStatus;
      readonly voidWarnings: readonly string[];
    }
  | { readonly ok: false; readonly error: string }
> {
  const access = await authorizeOffer(principal, input.offerId, db);
  const offer = await db.offer.findUnique({
    select: { isActive: true, offerStatus: true },
    where: { id: access.offerId },
  });
  if (!offer)
    return { error: "This offer revision is unavailable.", ok: false };

  const recall = resolveRecall(
    input.scope,
    input.toStatus,
    offer.offerStatus,
    offer.isActive,
  );
  if (!recall.ok) return recall;

  const voids = await voidLiveOfferEnvelopes(db, envelopePort, {
    offerId: input.offerId,
    reason: "Recalled by the builder.",
    scope: recall.scope,
  });
  if (!decideRecallPullBack(voids).proceed) {
    return {
      error: describeUnconfirmedVoid({
        action: "recall",
        unsettled: voids.unsettled,
        voidedCount: voids.voidedIds.length,
      }),
      ok: false,
    };
  }

  const committed = await commitOfferStatusTransition(
    principal,
    {
      note: input.note,
      expectedFromStatus: offer.offerStatus,
      offerId: input.offerId,
      skipOwnerGate: true,
      skipTransitionCheck: true,
      toStatus: recall.to,
    },
    db,
  );
  if (!committed) {
    return {
      error: `${voids.voidedIds.length > 0 ? "The DocuSign envelope was voided and stays voided, but the" : "The"} offer's status changed before the recall could move it back. Refresh to see where it is now.`,
      ok: false,
    };
  }
  return { ok: true, status: recall.to, voidWarnings: [] };
}
