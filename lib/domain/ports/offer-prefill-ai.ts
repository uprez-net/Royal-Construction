import type {
  OfferPrefillDraft,
  OfferPrefillDraftResult,
} from "@/lib/offer/offer-prefill-ai";

export type OfferPrefillAiPort = (
  context: string,
) => Promise<OfferPrefillDraftResult>;

export type { OfferPrefillDraft };
