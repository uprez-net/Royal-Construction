/**
 * Turn text into vectors for the agent's context index.
 *
 * A port because the provider (the AI Gateway today) is an SDK the domain may
 * not import. The contract the index relies on: one vector per value, in
 * input order, every vector `dimensions` long. The index normalises them
 * itself, so a provider that does not is still safe to rank by inner product.
 */
export type EmbeddingPort = {
  readonly dimensions: number;
  readonly embed: (values: readonly string[]) => Promise<number[][]>;
};
