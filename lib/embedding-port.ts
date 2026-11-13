import { embedMany } from "ai";

import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import { reportExternalError } from "@/lib/observability/external";

/** Through the AI Gateway, like every other model call in this app. */
export const CONTEXT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * The one embedding implementation: the agent's context index and its search
 * both use it, so a record and a question are always embedded by the same
 * model — vectors from two models are not comparable at all.
 *
 * Node-clean (no Next, no server-only), because Eve's tools import it as well
 * as the cron route.
 */
export const gatewayEmbedding: EmbeddingPort = {
  dimensions: 1536,
  async embed(values) {
    if (!values.length) return [];
    try {
      const { embeddings } = await embedMany({
        abortSignal: AbortSignal.timeout(20_000),
        maxParallelCalls: 2,
        model: CONTEXT_EMBEDDING_MODEL,
        values: [...values],
      });
      return embeddings;
    } catch (error) {
      // Embedding is passed a model id, not a wrapped gateway model, so it does
      // not go through lib/model.ts. Its callers decide what a failure means;
      // this only makes sure someone hears about it.
      reportExternalError("ai", "embedMany", error);
      throw error;
    }
  },
};
