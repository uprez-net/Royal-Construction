import "server-only";

import { revalidateTag } from "next/cache";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import type { OfferSendEffects } from "@/lib/offer/sends/effects";
import { CACHE_PROFILES } from "@/types/cache";

/** The app's half of a send: its caches, and the lead stage with them. */
export const appOfferSendEffects: OfferSendEffects = {
  offerChanged(offerId) {
    // Best-effort: the send is committed, and a cache failure must not turn
    // it into a reported failure.
    try {
      revalidateTag(`offer-${offerId}`, CACHE_PROFILES.SHORT);
    } catch (error) {
      console.error(
        `[offer] revalidate after send failed for ${offerId}:`,
        error,
      );
    }
  },
  statusChanged: (offerId) => syncLeadStageForOffer(offerId),
};
