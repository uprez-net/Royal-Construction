import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
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
 * Never throws, and now that it owns its own connection that promise is real.
 *
 * Self-contained by design: it reads the lead itself rather than making every
 * caller carry `currentStage`. There are roughly eight places that write an
 * offer status, so the call has to be cheap enough that the next one added
 * remembers it.
 */
export async function syncLeadStageForOffer(
  offerId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      select: { offerStatus: true, leadId: true, lead: { select: { stage: true, wonAt: true } } },
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
    await prisma.lead.updateMany({
      where: { id: offer.leadId, stage: offer.lead?.stage ?? undefined },
      data: patch,
    });
  } catch (error) {
    console.error(`[Offer ${offerId}] Failed to sync lead stage`, error);
  } finally {
    expireOffersList(offerId);
  }
}

// Every offer status writer calls syncLeadStageForOffer, so this is where the
// offers list learns a status changed, including when the lead's stage did not
// need to move (the early returns above). `expire: 0`, not a stale window: the
// tab counts and badges must be current on the next load. It works from Route
// Handlers (the DocuSign webhook) as well as Server Actions. The catch keeps
// the never-throws promise, since revalidateTag throws outside a request.
function expireOffersList(offerId: string): void {
  try {
    revalidateTag("offers", { expire: 0 });
  } catch (error) {
    console.error(`[Offer ${offerId}] Failed to expire the offers list cache`, error);
  }
}
