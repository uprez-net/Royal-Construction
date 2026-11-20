import { Prisma } from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import {
  isOfficePrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { leadListScope } from "../access/leads";
import { canReadTradieDirectory } from "../access/tradies";
import type { EmbeddingPort } from "../ports/embedding";
import { loadContextChunks, type ContextSelection } from "./sources";
import { listUnreadDocuments } from "./files";
import {
  OFFICE_DIGEST_ENTITY_ID,
  type AgentContextKind,
  type ChunkDraft,
} from "./text";
import { lexicalBoost, queryTerms } from "./ranking";
import {
  CONTEXT_EMBEDDING_DIMENSIONS,
  EMBED_BATCH,
  contentHash as contentHashOf,
  vectorLiteral,
} from "./vectors";

// The operations agent's context index: refresh it, search it, read the
// office digest. See AgentContextChunk in prisma/schema.prisma for what the
// rows are, and ./text.ts for how their words are chosen. Uploaded documents
// have their own index beside it (./files.ts), refreshed by the same run.

export type { ContextSelection } from "./sources";
export type { AgentContextKind } from "./text";

export {
  CONTEXT_EMBEDDING_DIMENSIONS,
  contentHash,
  normalizeVector,
} from "./vectors";
export { lexicalBoost, queryTerms } from "./ranking";
export {
  listUnreadDocuments,
  filedUnderLabels,
  isFiledUnderAnotherRecord,
  refreshAgentFiles,
  searchAgentFiles,
  type AgentFileHit,
  type FiledUnder,
  type RefreshAgentFilesResult,
} from "./files";

export type RefreshAgentContextResult = {
  readonly scanned: number;
  readonly embedded: number;
  readonly unchanged: number;
  readonly removed: number;
  /** The provider failed; changed rows were saved without a vector and stay findable by name. */
  readonly embeddingFailed: boolean;
};

function key(kind: string, entityId: string) {
  return `${kind}:${entityId}`;
}

function selectionWhere(
  selection: ContextSelection,
): Prisma.AgentContextChunkWhereInput {
  const ors: Prisma.AgentContextChunkWhereInput[] = [];
  if (selection.leadIds?.length)
    ors.push({ entityId: { in: selection.leadIds.map(String) }, kind: "lead" });
  if (selection.projectIds?.length)
    ors.push({ entityId: { in: [...selection.projectIds] }, kind: "project" });
  if (selection.tradieIds?.length)
    ors.push({ entityId: { in: [...selection.tradieIds] }, kind: "tradie" });
  return ors.length ? { OR: ors } : { id: "__nothing__" };
}

function selectionKeys(selection: ContextSelection): Set<string> {
  return new Set([
    ...(selection.leadIds ?? []).map((id) => key("lead", String(id))),
    ...(selection.projectIds ?? []).map((id) => key("project", id)),
    ...(selection.tradieIds ?? []).map((id) => key("tradie", id)),
  ]);
}

/**
 * Rebuild the index from the CRM: every live record when `selection` is
 * omitted (the nightly run), or just the records named (after an agent write).
 *
 * Text is rewritten every time; a row is re-embedded only when its text
 * changed or it has no vector yet, so the nightly run costs embeddings for
 * what moved that day, not for the whole book. A record that is no longer
 * live (archived, closed long ago, deleted) loses its row.
 */
export async function refreshAgentContext(
  principal: DomainPrincipal,
  input: { selection?: ContextSelection; now?: Date },
  db: DomainDb,
  ports: { embedding?: EmbeddingPort } = {},
): Promise<RefreshAgentContextResult> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const drafts = await loadContextChunks(db, now, input.selection, {
    unreadDocuments: listUnreadDocuments,
  });

  const existing = await db.agentContextChunk.findMany({
    select: { contentHash: true, entityId: true, id: true, kind: true },
    where: input.selection ? selectionWhere(input.selection) : {},
  });
  const missingVectors = new Set(
    (
      await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "AgentContextChunk" WHERE "embedding" IS NULL`
    ).map((row) => row.id),
  );
  const byKey = new Map(
    existing.map((row) => [key(row.kind, row.entityId), row]),
  );

  // Each carries the hash of the text it embeds, so a vector is only written
  // over the text it was made from (see the UPDATE below).
  const toEmbed: { id: string; content: string; hash: string }[] = [];
  const confirmedIds: string[] = [];
  let unchanged = 0;
  for (const draft of drafts) {
    const hash = contentHashOf(draft.content);
    const row = byKey.get(key(draft.kind, draft.entityId));
    if (row && row.contentHash === hash) {
      // Same text, so the same title: only the "checked at" moves.
      confirmedIds.push(row.id);
      if (missingVectors.has(row.id))
        toEmbed.push({ content: draft.content, hash, id: row.id });
      else unchanged += 1;
      continue;
    }
    const saved = await upsertChunk(draft, hash, now, db);
    toEmbed.push({ content: draft.content, hash, id: saved });
  }
  if (confirmedIds.length) {
    await db.agentContextChunk.updateMany({
      data: { refreshedAt: now },
      where: { id: { in: confirmedIds } },
    });
  }

  const draftKeys = new Set(drafts.map((d) => key(d.kind, d.entityId)));
  const staleIds = existing
    .filter((row) => {
      const rowKey = key(row.kind, row.entityId);
      if (draftKeys.has(rowKey)) return false;
      // A targeted refresh only removes the rows it was asked about; the
      // digest is the nightly run's to replace.
      return input.selection
        ? selectionKeys(input.selection).has(rowKey)
        : true;
    })
    .map((row) => row.id);
  if (staleIds.length) {
    await db.agentContextChunk.deleteMany({ where: { id: { in: staleIds } } });
  }

  let embedded = 0;
  let embeddingFailed = false;
  if (ports.embedding && toEmbed.length) {
    try {
      for (let start = 0; start < toEmbed.length; start += EMBED_BATCH) {
        const batch = toEmbed.slice(start, start + EMBED_BATCH);
        const vectors = await ports.embedding.embed(
          batch.map((b) => b.content),
        );
        for (const [index, item] of batch.entries()) {
          const vector = vectors[index];
          if (!vector || vector.length !== CONTEXT_EMBEDDING_DIMENSIONS) {
            // The row keeps its text and no vector; say so rather than
            // reporting a clean run.
            embeddingFailed = true;
            continue;
          }
          // Only over the text this vector was made from: when two refreshes
          // overlap, a slower one must not pair its older vector with newer
          // text (or overwrite the newer text's own vector).
          const written = await db.$executeRaw`
            UPDATE "AgentContextChunk"
            SET "embedding" = ${vectorLiteral(vector)}::vector
            WHERE "id" = ${item.id} AND "contentHash" = ${item.hash}`;
          if (written > 0) embedded += 1;
        }
      }
    } catch {
      // Rows keep their new text with no vector: search still finds them by
      // name, and the next run embeds them. The caller reports the failure.
      embeddingFailed = true;
    }
  } else if (toEmbed.length) {
    embeddingFailed = true;
  }

  return {
    embedded,
    embeddingFailed,
    removed: staleIds.length,
    scanned: drafts.length,
    unchanged,
  };
}

/** Insert or rewrite one chunk, clearing a vector that no longer matches it. */
async function upsertChunk(
  draft: ChunkDraft,
  hash: string,
  now: Date,
  db: DomainDb,
): Promise<string> {
  const saved = await db.agentContextChunk.upsert({
    create: {
      content: draft.content,
      contentHash: hash,
      entityId: draft.entityId,
      kind: draft.kind,
      refreshedAt: now,
      title: draft.title,
    },
    select: { id: true },
    update: {
      content: draft.content,
      contentHash: hash,
      refreshedAt: now,
      title: draft.title,
    },
    where: { kind_entityId: { entityId: draft.entityId, kind: draft.kind } },
  });
  await db.$executeRaw`
    UPDATE "AgentContextChunk" SET "embedding" = NULL WHERE "id" = ${saved.id}`;
  return saved.id;
}

export type AgentContextHit = {
  readonly kind: AgentContextKind;
  readonly entityId: string;
  readonly title: string;
  readonly content: string;
  readonly refreshedAt: Date;
  readonly score: number;
};

const SEARCHABLE_KINDS: readonly AgentContextKind[] = [
  "lead",
  "project",
  "tradie",
];
/**
 * The records most like `query`, best first, that this caller may see.
 *
 * Ranked by the inner product of normalised embeddings (pgvector `<#>`), plus
 * a bonus for words that appear in the record's name. With no embedding port,
 * or a provider failure, it degrades to the name match alone rather than
 * failing the agent's turn.
 */
export async function searchAgentContext(
  principal: DomainPrincipal,
  input: { query: string; limit?: number; kinds?: readonly AgentContextKind[] },
  db: DomainDb,
  ports: { embedding?: EmbeddingPort } = {},
): Promise<AgentContextHit[]> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "The office context is available to staff only.",
    );
  }
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 15);
  const kinds = (input.kinds?.length ? input.kinds : SEARCHABLE_KINDS).filter(
    (kind) => kind !== "digest",
  );
  const terms = queryTerms(input.query);
  const candidates = new Map<string, AgentContextHit>();

  let queryVector: number[] | null = null;
  if (ports.embedding) {
    try {
      const [vector] = await ports.embedding.embed([input.query]);
      if (vector?.length === CONTEXT_EMBEDDING_DIMENSIONS) queryVector = vector;
    } catch (error) {
      // Name matching still answers; the log says why ranking was weaker.
      console.error(
        "[agent-context] query embedding failed; searching by name only",
        error instanceof Error ? error.message : error,
      );
      queryVector = null;
    }
  }

  if (queryVector) {
    const rows = await db.$queryRaw<
      {
        content: string;
        entityId: string;
        kind: string;
        refreshedAt: Date;
        score: number;
        title: string;
      }[]
    >`
      SELECT "kind", "entityId", "title", "content", "refreshedAt",
             -("embedding" <#> ${vectorLiteral(queryVector)}::vector) AS "score"
      FROM "AgentContextChunk"
      WHERE "embedding" IS NOT NULL AND "kind" = ANY(${[...kinds]})
      ORDER BY "embedding" <#> ${vectorLiteral(queryVector)}::vector
      LIMIT ${limit * 4}`;
    for (const row of rows) {
      candidates.set(key(row.kind, row.entityId), {
        content: row.content,
        entityId: row.entityId,
        kind: row.kind as AgentContextKind,
        refreshedAt: row.refreshedAt,
        score: Number(row.score),
        title: row.title,
      });
    }
  }

  if (terms.length) {
    const named = await db.agentContextChunk.findMany({
      select: {
        content: true,
        entityId: true,
        kind: true,
        refreshedAt: true,
        title: true,
      },
      take: limit * 4,
      where: {
        kind: { in: [...kinds] },
        OR: terms.map((term) => ({
          title: { contains: term, mode: "insensitive" as const },
        })),
      },
    });
    for (const row of named) {
      const rowKey = key(row.kind, row.entityId);
      if (!candidates.has(rowKey)) {
        candidates.set(rowKey, {
          ...row,
          kind: row.kind as AgentContextKind,
          score: 0,
        });
      }
    }
  }

  const ranked = [...candidates.values()]
    .map((hit) => ({
      ...hit,
      score: hit.score + lexicalBoost(terms, hit.title, hit.content),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  const visible = await visibleHits(principal, ranked, db);
  return visible.slice(0, limit);
}

/**
 * Drop what this caller could not open through the record's own screen.
 *
 * The same scopes the lists use — nothing new is decided here. With everyone
 * an ADMIN today this removes nothing; it is the rule a site manager or a
 * guest will meet when those accounts exist.
 */
async function visibleHits(
  principal: DomainPrincipal,
  hits: AgentContextHit[],
  db: DomainDb,
): Promise<AgentContextHit[]> {
  const scope = leadListScope(principal);
  let hiddenLeads = new Set<string>();
  if (scope.assignedId !== null) {
    const leadIds = hits
      .filter((hit) => hit.kind === "lead")
      .map((hit) => Number(hit.entityId));
    const allowed = await db.lead.findMany({
      select: { id: true },
      where: { assignedId: scope.assignedId, id: { in: leadIds } },
    });
    const allowedIds = new Set(allowed.map((lead) => String(lead.id)));
    hiddenLeads = new Set(
      leadIds.map(String).filter((id) => !allowedIds.has(id)),
    );
  }
  const tradiesVisible = canReadTradieDirectory(principal);
  return hits.filter((hit) => {
    if (hit.kind === "lead") return !hiddenLeads.has(hit.entityId);
    if (hit.kind === "tradie") return tradiesVisible;
    return true;
  });
}

export type OfficeDigest = {
  readonly content: string;
  readonly refreshedAt: Date;
};

/** The whole-business snapshot. Administrators only: it is every client's money. */
export async function readOfficeDigest(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<OfficeDigest | null> {
  requireAdminPrincipal(principal);
  return db.agentContextChunk.findUnique({
    select: { content: true, refreshedAt: true },
    where: {
      kind_entityId: { entityId: OFFICE_DIGEST_ENTITY_ID, kind: "digest" },
    },
  });
}

/** Which records an entity reference touches, as a refresh selection. */
export function selectionFor(
  refs: readonly { type: string; id: string }[],
): ContextSelection | null {
  const leadIds = new Set<number>();
  const projectIds = new Set<string>();
  const tradieIds = new Set<string>();
  for (const ref of refs) {
    if (ref.type === "lead") {
      const id = Number(ref.id);
      if (Number.isSafeInteger(id) && id > 0) leadIds.add(id);
    } else if (ref.type === "project") projectIds.add(ref.id);
    else if (ref.type === "tradie") tradieIds.add(ref.id);
  }
  if (!leadIds.size && !projectIds.size && !tradieIds.size) return null;
  return {
    leadIds: [...leadIds],
    projectIds: [...projectIds],
    tradieIds: [...tradieIds],
  };
}
