import type {
  ConsistencyCheckInput,
  ConsistencyCheckResult,
  HighlightDraftResult,
} from "@/lib/offer/inclusion-consistency-ai";

export type OfferInclusionAiPort = {
  readonly checkConsistency: (
    input: ConsistencyCheckInput,
  ) => Promise<ConsistencyCheckResult>;
  readonly draftHighlights: (
    scheduled: readonly string[],
  ) => Promise<HighlightDraftResult>;
};
