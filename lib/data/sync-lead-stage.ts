import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { syncLeadStageForOffer as syncLeadStageDomain } from "@/lib/domain/leads/stage-sync";

/**
 * Bring a lead's stage into line with its offer's status, then expire the
 * offers list.
 *
 * The rule is lib/domain/leads/stage-sync.ts — read the long note there before
 * changing when this is called. This wrapper exists for the cache line below,
 * which is the half that cannot leave Next.
 *
 * Never throws, which every caller relies on: the DocuSign webhook calls it
 * after answering, and a throw here would surface as a failed delivery for a
 * signature that was already recorded.
 */
export async function syncLeadStageForOffer(
  offerId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await syncLeadStageDomain(offerId, prisma, now);
  } finally {
    expireOffersList(offerId);
  }
}

// Every offer status writer calls syncLeadStageForOffer, so this is where the
// offers list learns a status changed, including when the lead's stage did not
// need to move (the early returns in the domain command). `expire: 0`, not a
// stale window: the tab counts and badges must be current on the next load. It
// works from Route Handlers (the DocuSign webhook) as well as Server Actions.
// The catch keeps the never-throws promise, since revalidateTag throws outside
// a request.
function expireOffersList(offerId: string): void {
  try {
    revalidateTag("offers", { expire: 0 });
  } catch (error) {
    console.error(
      `[Offer ${offerId}] Failed to expire the offers list cache`,
      error,
    );
  }
}
