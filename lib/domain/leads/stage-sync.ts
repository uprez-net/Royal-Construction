import type { TransactionalDomainDb } from "../db";
import { leadStagePatchForOfferStatus } from "@/lib/leads/offer-stage-map";

/**
 * Bring a lead's stage into line with its offer's current status.
 *
 * Call this AFTER the status write has committed. Not inside the caller's
 * transaction — that was the first design, and it was wrong in a way worth
 * recording, because the failure is silent:
 *
 *   A statement that fails inside a Prisma interactive transaction rolls the
 *   whole transaction back. Catching the error does NOT rescue it. The
 *   callback then returns normally, `$transaction` RESOLVES, and the caller is
 *   told it succeeded while every write it made is discarded. Verified against
 *   Postgres 18: an inner unique-violation swallowed exactly this way left the
 *   enclosing update rolled back with no error surfaced at all.
 *
 *   In the DocuSign webhook that is the worst possible outcome — the offer
 *   status flip and its OfferStatusEvent vanish, the handler answers 200, and
 *   DocuSign never retries. A signature would be lost to a reporting field.
 *
 * Running afterwards on the main client trades atomicity for isolation, which
 * is the right trade here: a lead whose stage lags is a reporting problem that
 * the next status change or the backfill will correct, because the mapping is
 * a projection of (status, currentStage) rather than a transition. A lost
 * signature is not recoverable.
 *
 * Which is also why it takes a TransactionalDomainDb: handed a caller's
 * transaction client it would reintroduce exactly the failure above, and the
 * type refuses that rather than trusting everyone to remember.
 *
 * Never throws, and now that it owns its own connection that promise is real.
 *
 * Self-contained by design: it reads the lead itself rather than making every
 * caller carry `currentStage`. There are roughly eight places that write an
 * offer status, so the call has to be cheap enough that the next one added
 * remembers it.
 *
 * Cache invalidation is NOT here. `revalidateTag` is a Next-only concept that
 * throws outside a request, and putting it in this module is what stopped a
 * cron or an Eve tool calling the rule at all. The adapter in
 * lib/data/sync-lead-stage.ts does it.
 */
export async function syncLeadStageForOffer(
  offerId: string,
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<void> {
  try {
    const offer = await db.offer.findUnique({
      where: { id: offerId },
      select: {
        offerStatus: true,
        leadId: true,
        lead: { select: { stage: true, wonAt: true } },
      },
    });
    if (!offer) return;

    const patch = leadStagePatchForOfferStatus(
      offer.offerStatus,
      offer.lead?.stage ?? null,
      now,
      offer.lead?.wonAt ?? null,
    );
    if (!patch) return;

    // Conditional on the stage we based the decision on, so a concurrent write
    // wins rather than being clobbered. A miss is not an error: the next
    // status change recomputes from scratch.
    await db.lead.updateMany({
      where: { id: offer.leadId, stage: offer.lead?.stage ?? undefined },
      data: patch,
    });
  } catch (error) {
    console.error(`[Offer ${offerId}] Failed to sync lead stage`, error);
  }
}
