import { createHash } from "node:crypto";

// What the record index and the document index share about vectors, so a
// record and a passage are hashed, normalised and written the same way.

/** text-embedding-3-small; the columns are vector(1536). */
export const CONTEXT_EMBEDDING_DIMENSIONS = 1536;
/** Values sent to the embedding provider per call. */
export const EMBED_BATCH = 64;

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Unit length, so ranking by inner product is ranking by cosine. */
export function normalizeVector(vector: readonly number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? vector.map((x) => x / norm) : [...vector];
}

/** A pgvector literal of the normalised vector. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${normalizeVector(vector).join(",")}]`;
}
