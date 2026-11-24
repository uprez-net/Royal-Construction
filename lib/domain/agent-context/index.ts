import { Prisma } from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import {
  isOfficePrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { leadListScope } from "../access/leads";
import { canSeeProjectFinancials } from "../access/projects";
import { canReadTradieDirectory } from "../access/tradies";
import type { EmbeddingPort } from "../ports/embedding";
import { loadContextChunks, type ContextSelection } from "./sources";
import { listUnreadDocuments } from "./files";
import {
  MONEY_SECTION,
  OFFICE_DIGEST_ENTITY_ID,
  type AgentContextKind,
  type ChunkDraft,
  type ContextSection,
} from "./text";
import { lexicalBoost, queryTerms } from "./ranking";
import { keywordScore, queryKeywords } from "./keywords";
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
export type { AgentContextKind, ContextSection } from "./text";

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
  /** Chunks whose text and vector were already current: not re-embedded. */
  readonly skipped: number;
  readonly removed: number;
  /** How long the refresh took, for the cron's response. */
  readonly durationMs: number;
  /** The provider failed; changed rows were saved without a vector and stay findable by name. */
  readonly embeddingFailed: boolean;
};

/** One record: a lead, offer, project, tradie or the digest. */
function key(kind: string, entityId: string) {
  return `${kind}:${entityId}`;
}

/** One chunk of a record. */
function chunkKey(kind: string, entityId: string, section: string) {
  return `${kind}:${entityId}:${section}`;
}

/**
 * What a chunk's vector was made from. Keywords, tags and the due date are
 * hashed with the text, so a row whose keywords changed is rewritten even
 * when its words did not.
 */
export function draftHash(draft: ChunkDraft): string {
  return contentHashOf(
    [
      draft.content,
      draft.keywords.join("|"),
      draft.tags.join("|"),
      draft.dueAt?.toISOString() ?? "",
    ].join("\n#\n"),
  );
}

function selectionWhere(
  selection: ContextSelection,
): Prisma.AgentContextChunkWhereInput {
  const ors: Prisma.AgentContextChunkWhereInput[] = [];
  // A lead's active offer is keyed by the lead's id and refreshed with it.
  if (selection.leadIds?.length)
    ors.push({
      entityId: { in: selection.leadIds.map(String) },
      kind: { in: ["lead", "offer"] },
    });
  if (selection.projectIds?.length)
    ors.push({ entityId: { in: [...selection.projectIds] }, kind: "project" });
  if (selection.tradieIds?.length)
    ors.push({ entityId: { in: [...selection.tradieIds] }, kind: "tradie" });
  return ors.length ? { OR: ors } : { id: "__nothing__" };
}

function selectionKeys(selection: ContextSelection): Set<string> {
  return new Set([
    ...(selection.leadIds ?? []).flatMap((id) => [
      key("lead", String(id)),
      key("offer", String(id)),
    ]),
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
  const started = Date.now();
  const now = input.now ?? new Date();
  const drafts = await loadContextChunks(db, now, input.selection, {
    unreadDocuments: listUnreadDocuments,
  });

  const existing = await db.agentContextChunk.findMany({
    select: {
      contentHash: true,
      entityId: true,
      id: true,
      kind: true,
      section: true,
    },
    where: input.selection ? selectionWhere(input.selection) : {},
  });
  const missingVectors = new Set(
    (
      await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "AgentContextChunk" WHERE "embedding" IS NULL`
    ).map((row) => row.id),
  );
  const byKey = new Map(
    existing.map((row) => [chunkKey(row.kind, row.entityId, row.section), row]),
  );

  // Each carries the hash of the text it embeds, so a vector is only written
  // over the text it was made from (see the UPDATE below).
  const toEmbed: { id: string; content: string; hash: string }[] = [];
  const confirmedIds: string[] = [];
  let unchanged = 0;
  for (const draft of drafts) {
    const hash = draftHash(draft);
    const row = byKey.get(chunkKey(draft.kind, draft.entityId, draft.section));
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

  const draftKeys = new Set(
    drafts.map((d) => chunkKey(d.kind, d.entityId, d.section)),
  );
  const asked = input.selection ? selectionKeys(input.selection) : null;
  const staleIds = existing
    .filter((row) => {
      if (draftKeys.has(chunkKey(row.kind, row.entityId, row.section)))
        return false;
      // A section with nothing left to say goes too. A targeted refresh only
      // removes rows of the records it was asked about; the digest is the
      // morning run's to replace.
      return asked ? asked.has(key(row.kind, row.entityId)) : true;
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
    durationMs: Date.now() - started,
    embedded,
    embeddingFailed,
    removed: staleIds.length,
    scanned: drafts.length,
    skipped: unchanged,
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
  const fields = {
    content: draft.content,
    contentHash: hash,
    dueAt: draft.dueAt,
    keywords: [...draft.keywords],
    refreshedAt: now,
    tags: [...draft.tags],
    title: draft.title,
  };
  const saved = await db.agentContextChunk.upsert({
    create: {
      ...fields,
      entityId: draft.entityId,
      kind: draft.kind,
      section: draft.section,
    },
    select: { id: true },
    update: fields,
    where: {
      kind_entityId_section: {
        entityId: draft.entityId,
        kind: draft.kind,
        section: draft.section,
      },
    },
  });
  await db.$executeRaw`
    UPDATE "AgentContextChunk" SET "embedding" = NULL WHERE "id" = ${saved.id}`;
  return saved.id;
}

export type AgentContextHit = {
  readonly kind: AgentContextKind;
  readonly entityId: string;
  readonly title: string;
  /** The best-matching section's text, header and Refs included. */
  readonly content: string;
  /** Which section `content` is. */
  readonly section: ContextSection;
  /** The record's other sections that also matched, by name. */
  readonly alsoMatched: readonly ContextSection[];
  readonly tags: readonly string[];
  /** The earliest open date in `content`, if any. */
  readonly dueAt: Date | null;
  /** Decided at read time from `dueAt`, never written into the snapshot. */
  readonly overdue: boolean;
  readonly dueSoon: boolean;
  readonly refreshedAt: Date;
  readonly score: number;
};

const SEARCHABLE_KINDS: readonly AgentContextKind[] = [
  "lead",
  "offer",
  "project",
  "tradie",
];

/** "Due soon": within this many days of the read. */
const DUE_SOON_DAYS = 3;

type CandidateRow = {
  kind: string;
  entityId: string;
  section: string;
  title: string;
  content: string;
  keywords: string[];
  tags: string[];
  dueAt: Date | null;
  refreshedAt: Date;
};

type Candidate = CandidateRow & { vector: number };

/**
 * The records most like `query`, best first, that this caller may see.
 *
 * Three ways in, merged per record (#621):
 * - by vector: the inner product of normalised embeddings (pgvector `<#>`),
 *   per section;
 * - by keyword: the question's forms (`queryKeywords`) matched exactly against
 *   each record's keywords in the database, so "12 Example Street" finds the
 *   project saved as "12 Example St" and "RC 2026 014" the offer RC-2026-014;
 * - by name: words that appear in the record's title.
 *
 * A record scores its best section's vector plus the keyword and name
 * evidence. With no embedding port, or a provider failure, it degrades to
 * keywords and names rather than failing the agent's turn.
 */
export async function searchAgentContext(
  principal: DomainPrincipal,
  input: { query: string; limit?: number; kinds?: readonly AgentContextKind[] },
  db: DomainDb,
  ports: { embedding?: EmbeddingPort } = {},
  now: Date = new Date(),
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
  const queryKeys = queryKeywords(input.query);
  // A price is a client's money: a caller who may not see it never gets the
  // section that holds it, by any route.
  const hiddenSections: string[] = canSeeProjectFinancials(principal)
    ? []
    : [MONEY_SECTION];
  const candidates = new Map<string, Candidate>();
  const consider = (row: CandidateRow, vector: number) => {
    if (hiddenSections.includes(row.section)) return;
    const rowKey = chunkKey(row.kind, row.entityId, row.section);
    const known = candidates.get(rowKey);
    if (!known || vector > known.vector)
      candidates.set(rowKey, { ...row, vector });
  };

  let queryVector: number[] | null = null;
  if (ports.embedding) {
    try {
      const [vector] = await ports.embedding.embed([input.query]);
      if (vector?.length === CONTEXT_EMBEDDING_DIMENSIONS) queryVector = vector;
    } catch (error) {
      // Keywords and names still answer; the log says why ranking was weaker.
      console.error(
        "[agent-context] query embedding failed; searching by keyword and name only",
        error instanceof Error ? error.message : error,
      );
      queryVector = null;
    }
  }

  if (queryVector) {
    const rows = await db.$queryRaw<(CandidateRow & { score: number })[]>`
      SELECT "kind", "entityId", "section", "title", "content", "keywords",
             "tags", "dueAt", "refreshedAt",
             -("embedding" <#> ${vectorLiteral(queryVector)}::vector) AS "score"
      FROM "AgentContextChunk"
      WHERE "embedding" IS NOT NULL AND "kind" = ANY(${[...kinds]})
        ${
          hiddenSections.length
            ? Prisma.sql`AND NOT ("section" = ANY(${hiddenSections}))`
            : Prisma.empty
        }
      ORDER BY "embedding" <#> ${vectorLiteral(queryVector)}::vector
      LIMIT ${limit * 8}`;
    for (const row of rows) consider(row, Number(row.score));
  }

  const select = {
    content: true,
    dueAt: true,
    entityId: true,
    keywords: true,
    kind: true,
    refreshedAt: true,
    section: true,
    tags: true,
    title: true,
  } as const;
  // One row per record. Every section of a record carries the same keywords
  // and title, so reading them all let one suburb's five-section records fill
  // the cap before the exact address was reached. The overview (or a
  // tradie's single `record`) stands for the record; it is never money.
  const recordSections = { in: ["overview", "record"] };
  const [byKeyword, byName] = await Promise.all([
    queryKeys.length
      ? db.agentContextChunk.findMany({
          select,
          take: limit * 8,
          where: {
            keywords: { hasSome: queryKeys },
            kind: { in: [...kinds] },
            section: recordSections,
          },
        })
      : Promise.resolve([]),
    terms.length
      ? db.agentContextChunk.findMany({
          select,
          take: limit * 8,
          where: {
            kind: { in: [...kinds] },
            OR: terms.map((term) => ({
              title: { contains: term, mode: "insensitive" as const },
            })),
            section: recordSections,
          },
        })
      : Promise.resolve([]),
  ]);
  for (const row of [...byKeyword, ...byName]) consider(row, 0);

  const records = new Map<string, Candidate[]>();
  for (const candidate of candidates.values()) {
    const recordKey = key(candidate.kind, candidate.entityId);
    const list = records.get(recordKey) ?? [];
    list.push(candidate);
    records.set(recordKey, list);
  }

  const soon = now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  const ranked: AgentContextHit[] = [];
  for (const sections of records.values()) {
    // The section the question matched by meaning first; with no vector,
    // the overview says the most about the record.
    sections.sort(
      (a, b) =>
        b.vector - a.vector
        || Number(b.section === "overview") - Number(a.section === "overview"),
    );
    const best = sections[0]!;
    const keywords = [...new Set(sections.flatMap((s) => s.keywords))];
    const score =
      best.vector
      + keywordScore(queryKeys, keywords)
      + lexicalBoost(terms, best.title, best.content);
    if (score <= 0) continue;
    const dueAt = best.dueAt;
    ranked.push({
      alsoMatched: sections.slice(1).map((s) => s.section as ContextSection),
      content: best.content,
      dueAt,
      dueSoon:
        dueAt !== null
        && dueAt.getTime() >= now.getTime()
        && dueAt.getTime() <= soon,
      entityId: best.entityId,
      kind: best.kind as AgentContextKind,
      overdue: dueAt !== null && dueAt.getTime() < now.getTime(),
      refreshedAt: best.refreshedAt,
      score,
      section: best.section as ContextSection,
      tags: best.tags,
      title: best.title,
    });
  }
  ranked.sort((a, b) => b.score - a.score);

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
    // An offer's chunks carry its lead's id, and follow the lead's scope.
    const leadIds = hits
      .filter((hit) => hit.kind === "lead" || hit.kind === "offer")
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
    if (hit.kind === "lead" || hit.kind === "offer")
      return !hiddenLeads.has(hit.entityId);
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
      kind_entityId_section: {
        entityId: OFFICE_DIGEST_ENTITY_ID,
        kind: "digest",
        section: "record",
      },
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
