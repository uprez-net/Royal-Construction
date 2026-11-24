import type { DomainDb } from "../../db";
import { searchAgentContext, type AgentContextKind } from "../../agent-context";
import type { EmbeddingPort } from "../../ports/embedding";
import type { UserPrincipal } from "../../principal";

// Mili's first try at the record a caller means (#621): the same context
// index the office agent searches, under the caller's re-checked identity.
//
// Voice lookups used to be substring searches with street-type rewriting
// (project-search.ts), which missed a spoken address said differently from
// how it was typed (#609) and could not hear an offer reference at all. The
// index holds each record's keywords in the forms people say them, so a
// short, spoken description resolves on the first try more often.
//
// The index is a snapshot. It only says which record is meant: every lookup
// still reads the record live, through its own scoped query, before Mili says
// anything about it. When the index cannot answer (a failure, nothing close),
// the caller falls back to the scoped substring search.

/** A record the index would stake a lookup on. */
const MIN_SCORE = 0.35;
/** How far ahead the best match must be to count as the only one. */
const CLEAR_LEAD = 0.2;

export type IndexResolution =
  | { readonly kind: "one"; readonly entityId: string }
  | { readonly kind: "several"; readonly entityIds: readonly string[] }
  | { readonly kind: "none" };

export async function resolveThroughIndex(
  principal: UserPrincipal,
  words: string,
  kind: Exclude<AgentContextKind, "digest">,
  db: DomainDb,
  ports: { readonly embedding?: EmbeddingPort },
): Promise<IndexResolution> {
  let hits;
  try {
    hits = await searchAgentContext(
      principal,
      { kinds: [kind], limit: 5, query: words },
      db,
      ports,
    );
  } catch (error) {
    // A refusal (a caller the index is not for) or an outage: the scoped
    // substring search still answers. Logged without the caller's words.
    console.error(
      `[voice-lookup] context index unavailable for a ${kind} lookup; searching live`,
      error instanceof Error ? error.message : error,
    );
    return { kind: "none" };
  }
  const strong = hits.filter((hit) => hit.score >= MIN_SCORE);
  const [best, second] = strong;
  if (!best) return { kind: "none" };
  if (!second || best.score - second.score >= CLEAR_LEAD) {
    return { entityId: best.entityId, kind: "one" };
  }
  return {
    entityIds: strong
      .filter((hit) => best.score - hit.score < CLEAR_LEAD)
      .map((hit) => hit.entityId),
    kind: "several",
  };
}
