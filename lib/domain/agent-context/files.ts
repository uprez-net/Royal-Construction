import { Prisma } from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import {
  isInternalPrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { leadListScope } from "../access/leads";
import type { DocumentTextPort } from "../ports/document-text";
import type { EmbeddingPort } from "../ports/embedding";
import { chunkPages } from "./chunking";
import {
  documentPassage,
  documentTitle,
  loadFileSources,
  offerReference,
  type FileSource,
} from "./file-sources";
import { lexicalBoost, queryTerms } from "./ranking";
import {
  CONTEXT_EMBEDDING_DIMENSIONS,
  EMBED_BATCH,
  contentHash,
  vectorLiteral,
} from "./vectors";

// Uploaded documents in the operations agent's context index.
//
// The nightly run reads each document once (OCR for PDFs, scans, photos and
// Office files; directly for text and spreadsheets), cuts it into passages
// (./chunking.ts), heads each passage with the document and the lead, project
// and offer it belongs to (./file-sources.ts), and embeds the passages that
// changed. Reading is the slow, paid part, so it is cached per blob in
// AgentFileText and bounded per run: a large backlog drains over several runs,
// newest documents first.
//
// Document text is whatever the uploader's file says. It is data for the agent
// to quote, never instructions — the tool that serves it says so.

/** A document that failed to read this many times is left until it changes. */
export const MAX_EXTRACTION_ATTEMPTS = 3;
/** Documents read per run; the rest wait for the next one. */
export const DEFAULT_MAX_EXTRACTIONS = 200;
/** Documents read at once: OCR is a network call that takes seconds. */
const EXTRACTION_CONCURRENCY = 3;
/** Sources handled per batch of reads and writes. */
const SOURCE_BATCH = 24;
/** Passages a search returns from one document, so one long file cannot fill the list. */
const PASSAGES_PER_DOCUMENT = 3;

export type RefreshAgentFilesResult = {
  /** Documents in the live set. */
  readonly documents: number;
  /** Read this run. */
  readonly extracted: number;
  /** Not a kind the reader reads, or too large. */
  readonly unsupported: number;
  /** Failed to read this run; retried on a later one. */
  readonly failed: number;
  /** Not read yet: the run ran out of time or reads, or no reader is configured. */
  readonly pending: number;
  /** The reader said it cannot read right now (no OCR key); those documents wait, unmarked. */
  readonly readerUnavailable: boolean;
  readonly passages: number;
  readonly embedded: number;
  /** Passages and cached text removed because their document left the live set. */
  readonly removed: number;
  /** The provider failed; passages were saved without a vector and stay findable by words. */
  readonly embeddingFailed: boolean;
};

type CachedText = {
  urlHash: string;
  status: string;
  attempts: number;
  pages: unknown;
};

function pagesOf(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((page) => typeof page === "string")
    ? (value as string[])
    : null;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next]!;
        next += 1;
        await run(item);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Bring the document index up to date with the live set.
 *
 * Without a `documentText` reader nothing new is read, but documents already
 * read keep their passages. Without an `embedding` port passages are saved
 * with no vector and are found by their words until a later run embeds them.
 */
export async function refreshAgentFiles(
  principal: DomainPrincipal,
  input: {
    readonly now?: Date;
    /** Stop starting reads after this instant; what is left waits for the next run. */
    readonly deadline?: Date;
    readonly maxExtractions?: number;
  },
  db: DomainDb,
  ports: {
    readonly embedding?: EmbeddingPort;
    readonly documentText?: DocumentTextPort;
  } = {},
): Promise<RefreshAgentFilesResult> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const maxExtractions = input.maxExtractions ?? DEFAULT_MAX_EXTRACTIONS;
  const sources = await loadFileSources(db, now);

  // Documents that left the live set, or whose record went: their passages
  // stop answering now, and their cached text goes with them. This runs
  // before the slow part on purpose. Deleting a File already removes its
  // passages through the foreign key; this sweep is what catches the rest (an
  // archived lead, an attachment dropped from a reply), and it must not wait
  // behind OCR and embedding that can fail or run out of time — a document
  // someone removed would keep answering until a run got all the way through.
  const removedPassages = await db.agentFileChunk.deleteMany({
    where: { sourceKey: { notIn: sources.map((source) => source.sourceKey) } },
  });
  const removedTexts = await db.agentFileText.deleteMany({
    where: { urlHash: { notIn: sources.map((source) => source.urlHash) } },
  });

  let extracted = 0;
  let unsupported = 0;
  let failed = 0;
  let pending = 0;
  let passages = 0;
  let readsStarted = 0;
  let readerUnavailable = false;

  const canStartRead = () =>
    ports.documentText !== undefined
    && readsStarted < maxExtractions
    && (!input.deadline || Date.now() < input.deadline.getTime());

  for (let start = 0; start < sources.length; start += SOURCE_BATCH) {
    const batch = sources.slice(start, start + SOURCE_BATCH);
    const cached = new Map(
      (
        await db.agentFileText.findMany({
          select: { attempts: true, pages: true, status: true, urlHash: true },
          where: { urlHash: { in: batch.map((source) => source.urlHash) } },
        })
      ).map((row): [string, CachedText] => [row.urlHash, row]),
    );

    const toRead = batch.filter((source) => {
      const text = cached.get(source.urlHash);
      if (!text) return true;
      return (
        text.status === "FAILED" && text.attempts < MAX_EXTRACTION_ATTEMPTS
      );
    });
    await mapWithConcurrency(toRead, EXTRACTION_CONCURRENCY, async (source) => {
      if (!canStartRead()) return;
      readsStarted += 1;
      const previous = cached.get(source.urlHash);
      const saved = await readDocument(
        source,
        previous,
        db,
        ports.documentText!,
      );
      if (saved === null) {
        // The reader cannot read this kind now (no OCR key). Not the
        // document's fault and not a read: other kinds still go ahead.
        readerUnavailable = true;
        readsStarted -= 1;
        return;
      }
      cached.set(source.urlHash, saved);
      if (saved.status === "EXTRACTED") extracted += 1;
      else if (saved.status === "UNSUPPORTED") unsupported += 1;
      else failed += 1;
    });

    const existing = await db.agentFileChunk.findMany({
      select: {
        chunkIndex: true,
        contentHash: true,
        id: true,
        sourceKey: true,
      },
      where: { sourceKey: { in: batch.map((source) => source.sourceKey) } },
    });
    const bySource = new Map<string, typeof existing>();
    for (const row of existing) {
      bySource.set(row.sourceKey, [
        ...(bySource.get(row.sourceKey) ?? []),
        row,
      ]);
    }

    const confirmed: string[] = [];
    const obsolete: string[] = [];
    for (const source of batch) {
      const rows = bySource.get(source.sourceKey) ?? [];
      const text = cached.get(source.urlHash);
      const pages = text?.status === "EXTRACTED" ? pagesOf(text.pages) : null;
      if (
        !text
        || (text.status === "FAILED" && text.attempts < MAX_EXTRACTION_ATTEMPTS)
      )
        pending += 1;
      const drafts = pages ? chunkPages(pages) : [];
      passages += drafts.length;
      const byIndex = new Map(rows.map((row) => [row.chunkIndex, row]));
      for (const [index, passage] of drafts.entries()) {
        const content = documentPassage(source, passage, pages!.length);
        const hash = contentHash(content);
        const row = byIndex.get(index);
        if (row?.contentHash === hash) {
          confirmed.push(row.id);
          continue;
        }
        await upsertPassage(source, index, passage, content, hash, now, db);
      }
      for (const row of rows) {
        if (row.chunkIndex >= drafts.length) obsolete.push(row.id);
      }
    }
    if (confirmed.length) {
      await db.agentFileChunk.updateMany({
        data: { refreshedAt: now },
        where: { id: { in: confirmed } },
      });
    }
    if (obsolete.length) {
      await db.agentFileChunk.deleteMany({ where: { id: { in: obsolete } } });
    }
  }

  const { embedded, embeddingFailed } = await embedMissingPassages(
    db,
    ports.embedding,
    input.deadline,
  );

  return {
    documents: sources.length,
    embedded,
    embeddingFailed,
    extracted,
    failed,
    passages,
    pending,
    readerUnavailable,
    removed: removedPassages.count + removedTexts.count,
    unsupported,
  };
}

/**
 * The live documents the index has failed to read, newest first, by name and
 * the record they are filed under, for the office digest.
 *
 * A failure was reported only through `console.error`, which nobody here
 * reads (#432). Cheap when nothing failed, which is the usual night: the live
 * set is loaded only when there is a failed read to name.
 */
export async function listUnreadDocuments(
  db: DomainDb,
  now: Date,
): Promise<{ filename: string; record: string | null; gaveUp: boolean }[]> {
  const failed = await db.agentFileText.findMany({
    select: { attempts: true, urlHash: true },
    where: { status: "FAILED" },
  });
  if (!failed.length) return [];
  const attemptsByHash = new Map(
    failed.map((row) => [row.urlHash, row.attempts]),
  );
  const sources = await loadFileSources(db, now);
  const seen = new Set<string>();
  const unread: { filename: string; record: string | null; gaveUp: boolean }[] =
    [];
  for (const source of sources) {
    const attempts = attemptsByHash.get(source.urlHash);
    if (attempts === undefined || seen.has(source.urlHash)) continue;
    seen.add(source.urlHash);
    unread.push({
      filename: source.filename,
      gaveUp: attempts >= MAX_EXTRACTION_ATTEMPTS,
      record: source.projectName ?? source.leadName ?? source.offerReference,
    });
  }
  return unread;
}

/**
 * Read one document and cache what came of it, success or not — or null when
 * the reader is unavailable, which records nothing against the document.
 */
async function readDocument(
  source: FileSource,
  previous: CachedText | undefined,
  db: DomainDb,
  reader: DocumentTextPort,
): Promise<CachedText | null> {
  let data: {
    status: string;
    reason: string | null;
    pages: string[];
    attempts: number;
  };
  try {
    const result = await reader.extract({
      filename: source.filename,
      mediaType: source.mediaType,
      sizeBytes: source.sizeBytes,
      url: source.url,
    });
    if (result.status === "unavailable") return null;
    data =
      result.status === "text"
        ? {
            attempts: 0,
            pages: [...result.pages],
            reason: null,
            status: "EXTRACTED",
          }
        : {
            attempts: 0,
            pages: [],
            reason: result.reason.slice(0, 300),
            status: "UNSUPPORTED",
          };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[agent-files] could not read ${source.sourceKey}; will retry`,
      reason,
    );
    data = {
      attempts: (previous?.attempts ?? 0) + 1,
      pages: [],
      reason: reason.slice(0, 300),
      status: "FAILED",
    };
  }
  await db.agentFileText.upsert({
    create: { ...data, urlHash: source.urlHash },
    update: { ...data, extractedAt: new Date() },
    where: { urlHash: source.urlHash },
  });
  return { ...data, urlHash: source.urlHash };
}

/** Insert or rewrite one passage, clearing a vector that no longer matches it. */
async function upsertPassage(
  source: FileSource,
  chunkIndex: number,
  passage: { pageFrom: number; pageTo: number },
  content: string,
  hash: string,
  now: Date,
  db: DomainDb,
): Promise<void> {
  const fields = {
    content,
    contentHash: hash,
    fileId: source.fileId,
    leadId: source.leadId,
    offerId: source.offerId,
    offerReplyId: source.offerReplyId,
    pageFrom: passage.pageFrom,
    pageTo: passage.pageTo,
    projectId: source.projectId,
    refreshedAt: now,
    title: documentTitle(source),
  };
  const saved = await db.agentFileChunk.upsert({
    create: { ...fields, chunkIndex, sourceKey: source.sourceKey },
    select: { id: true },
    update: fields,
    where: {
      sourceKey_chunkIndex: { chunkIndex, sourceKey: source.sourceKey },
    },
  });
  await db.$executeRaw`
    UPDATE "AgentFileChunk" SET "embedding" = NULL WHERE "id" = ${saved.id}`;
}

/**
 * Embed every passage with no vector: the ones written this run, and any an
 * earlier outage left behind. A vector is only written over the text it was
 * made from.
 */
async function embedMissingPassages(
  db: DomainDb,
  embedding: EmbeddingPort | undefined,
  deadline: Date | undefined,
): Promise<{ embedded: number; embeddingFailed: boolean }> {
  const missing = await db.$queryRaw<
    { id: string; content: string; contentHash: string }[]
  >`
    SELECT "id", "content", "contentHash" FROM "AgentFileChunk"
    WHERE "embedding" IS NULL
    ORDER BY "updatedAt" DESC, "id"`;
  if (!missing.length) return { embedded: 0, embeddingFailed: false };
  if (!embedding) return { embedded: 0, embeddingFailed: true };

  let embedded = 0;
  let embeddingFailed = false;
  try {
    for (let start = 0; start < missing.length; start += EMBED_BATCH) {
      // Past the deadline the rest wait for the next run, as unread documents do.
      if (deadline && Date.now() >= deadline.getTime()) break;
      const batch = missing.slice(start, start + EMBED_BATCH);
      const vectors = await embedding.embed(batch.map((row) => row.content));
      for (const [index, row] of batch.entries()) {
        const vector = vectors[index];
        if (!vector || vector.length !== CONTEXT_EMBEDDING_DIMENSIONS) {
          embeddingFailed = true;
          continue;
        }
        const written = await db.$executeRaw`
          UPDATE "AgentFileChunk"
          SET "embedding" = ${vectorLiteral(vector)}::vector
          WHERE "id" = ${row.id} AND "contentHash" = ${row.contentHash}`;
        if (written > 0) embedded += 1;
      }
    }
  } catch (error) {
    console.error(
      "[agent-files] embedding failed; passages saved without vectors",
      error instanceof Error ? error.message : error,
    );
    embeddingFailed = true;
  }
  return { embedded, embeddingFailed };
}

/**
 * The records a passage's document is filed under, by name, so a reader can
 * say which job it belongs to. Names are looked up live, not read from the
 * passage heading, so a renamed lead or project is named as it is now.
 */
export type FiledUnder = {
  readonly lead: { readonly id: number; readonly name: string } | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly offer: { readonly id: string; readonly reference: string } | null;
};

export type AgentFileHit = {
  readonly id: string;
  readonly sourceKey: string;
  readonly fileId: string | null;
  readonly title: string;
  readonly content: string;
  readonly pageFrom: number;
  readonly pageTo: number;
  readonly leadId: number | null;
  readonly projectId: string | null;
  readonly offerId: string | null;
  readonly refreshedAt: Date;
  readonly filedUnder: FiledUnder;
  readonly score: number;
};

type HitRow = Omit<AgentFileHit, "score" | "filedUnder">;

/** "Lead: Sandhu", "Project: 11 Wheat Street", "Offer: OF-105": what a person reads. */
export function filedUnderLabels(filedUnder: FiledUnder): string[] {
  return [
    filedUnder.lead ? `Lead: ${filedUnder.lead.name}` : null,
    filedUnder.project ? `Project: ${filedUnder.project.name}` : null,
    filedUnder.offer ? `Offer: ${filedUnder.offer.reference}` : null,
  ].filter((label): label is string => label !== null);
}

/**
 * True when the passage's document is filed under a *different* lead, project
 * or offer than one the caller asked about. A search for several ids matches
 * a passage under any of them, so a document can fit the lead asked for and
 * still belong to another project; the reader has to say so.
 */
export function isFiledUnderAnotherRecord(
  hit: Pick<AgentFileHit, "leadId" | "projectId" | "offerId">,
  requested: {
    readonly leadId?: number;
    readonly projectId?: string;
    readonly offerId?: string;
  },
): boolean {
  const differs = <T>(asked: T | undefined, filed: T | null) =>
    asked !== undefined && filed !== null && asked !== filed;
  return (
    differs(requested.leadId, hit.leadId)
    || differs(requested.projectId, hit.projectId)
    || differs(requested.offerId, hit.offerId)
  );
}

async function loadFiledUnder(
  hits: readonly HitRow[],
  db: DomainDb,
): Promise<Map<string, FiledUnder>> {
  const leadIds = [
    ...new Set(
      hits.flatMap((hit) => (hit.leadId === null ? [] : [hit.leadId])),
    ),
  ];
  const projectIds = [
    ...new Set(hits.flatMap((hit) => (hit.projectId ? [hit.projectId] : []))),
  ];
  const offerIds = [
    ...new Set(hits.flatMap((hit) => (hit.offerId ? [hit.offerId] : []))),
  ];
  const [leads, projects, offers] = await Promise.all([
    leadIds.length
      ? db.lead.findMany({
          select: { id: true, name: true },
          where: { id: { in: leadIds } },
        })
      : Promise.resolve([]),
    projectIds.length
      ? db.project.findMany({
          select: { id: true, name: true },
          where: { id: { in: projectIds } },
        })
      : Promise.resolve([]),
    offerIds.length
      ? db.offer.findMany({
          select: { baseReference: true, id: true, leadId: true },
          where: { id: { in: offerIds } },
        })
      : Promise.resolve([]),
  ]);
  const leadById = new Map(leads.map((row) => [row.id, row]));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const offerById = new Map(offers.map((row) => [row.id, row]));
  return new Map(
    hits.map((hit): [string, FiledUnder] => {
      const lead = hit.leadId === null ? undefined : leadById.get(hit.leadId);
      const project = hit.projectId
        ? projectById.get(hit.projectId)
        : undefined;
      const offer = hit.offerId ? offerById.get(hit.offerId) : undefined;
      return [
        hit.id,
        {
          lead: lead ? { id: lead.id, name: lead.name } : null,
          offer: offer
            ? {
                id: offer.id,
                reference: offerReference(offer.baseReference, offer.leadId),
              }
            : null,
          project: project ? { id: project.id, name: project.name } : null,
        },
      ];
    }),
  );
}

const HIT_SELECT = {
  content: true,
  id: true,
  fileId: true,
  leadId: true,
  offerId: true,
  pageFrom: true,
  pageTo: true,
  projectId: true,
  refreshedAt: true,
  sourceKey: true,
  title: true,
} as const;

/**
 * The passages of uploaded documents most like `query`, best first, that this
 * caller may see — optionally only those filed under a given lead, project or
 * offer (any of them: they are usually the same job).
 *
 * Ranked like the record index: the inner product of normalised embeddings,
 * plus a bonus for the request's words in the passage. With no embedding, or a
 * provider failure, it falls back to the word match alone.
 */
export async function searchAgentFiles(
  principal: DomainPrincipal,
  input: {
    readonly query: string;
    readonly leadId?: number;
    readonly projectId?: string;
    readonly offerId?: string;
    readonly limit?: number;
  },
  db: DomainDb,
  ports: { readonly embedding?: EmbeddingPort } = {},
): Promise<AgentFileHit[]> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "The office's documents are available to staff only.",
    );
  }
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const terms = queryTerms(input.query);

  const recordFilters: Prisma.AgentFileChunkWhereInput[] = [];
  const sqlFilters: Prisma.Sql[] = [];
  if (input.leadId !== undefined) {
    recordFilters.push({ leadId: input.leadId });
    sqlFilters.push(Prisma.sql`"leadId" = ${input.leadId}`);
  }
  if (input.projectId) {
    recordFilters.push({ projectId: input.projectId });
    sqlFilters.push(Prisma.sql`"projectId" = ${input.projectId}`);
  }
  if (input.offerId) {
    recordFilters.push({ offerId: input.offerId });
    sqlFilters.push(Prisma.sql`"offerId" = ${input.offerId}`);
  }

  let queryVector: number[] | null = null;
  if (ports.embedding) {
    try {
      const [vector] = await ports.embedding.embed([input.query]);
      if (vector?.length === CONTEXT_EMBEDDING_DIMENSIONS) queryVector = vector;
    } catch (error) {
      console.error(
        "[agent-files] query embedding failed; searching by words only",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const candidates = new Map<string, HitRow & { score: number }>();

  if (queryVector) {
    const literal = vectorLiteral(queryVector);
    const rows = await db.$queryRaw<(HitRow & { score: number })[]>`
      SELECT "id", "sourceKey", "fileId", "title", "content", "pageFrom", "pageTo",
             "leadId", "projectId", "offerId", "refreshedAt",
             -("embedding" <#> ${literal}::vector) AS "score"
      FROM "AgentFileChunk"
      WHERE "embedding" IS NOT NULL
        ${sqlFilters.length ? Prisma.sql`AND (${Prisma.join(sqlFilters, " OR ")})` : Prisma.empty}
      ORDER BY "embedding" <#> ${literal}::vector
      LIMIT ${limit * 6}`;
    for (const row of rows) {
      candidates.set(row.id, { ...row, score: Number(row.score) });
    }
  }

  if (terms.length) {
    const rows = await db.agentFileChunk.findMany({
      select: HIT_SELECT,
      take: limit * 6,
      where: {
        AND: [
          recordFilters.length ? { OR: recordFilters } : {},
          {
            OR: terms.flatMap((term) => [
              { title: { contains: term, mode: "insensitive" as const } },
              { content: { contains: term, mode: "insensitive" as const } },
            ]),
          },
        ],
      },
    });
    for (const row of rows) {
      if (!candidates.has(row.id)) candidates.set(row.id, { ...row, score: 0 });
    }
  }

  const ranked = [...candidates.values()]
    .map((hit) => ({
      ...hit,
      score: hit.score + lexicalBoost(terms, hit.title, hit.content),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  const visible = await visibleToCaller(principal, ranked, db);
  const perDocument = new Map<string, number>();
  const chosen: typeof visible = [];
  for (const hit of visible) {
    const count = perDocument.get(hit.sourceKey) ?? 0;
    if (count >= PASSAGES_PER_DOCUMENT) continue;
    perDocument.set(hit.sourceKey, count + 1);
    chosen.push(hit);
    if (chosen.length >= limit) break;
  }
  const filedUnder = await loadFiledUnder(chosen, db);
  return chosen.map((hit) => ({
    ...hit,
    filedUnder: filedUnder.get(hit.id) ?? {
      lead: null,
      offer: null,
      project: null,
    },
  }));
}

/**
 * Drop passages filed under a lead this caller's lead list would not show.
 * The same scope the screens and the record index use; with everyone an ADMIN
 * today it removes nothing. A passage with no lead is a project's, which all
 * staff see.
 */
async function visibleToCaller<T extends { leadId: number | null }>(
  principal: DomainPrincipal,
  hits: T[],
  db: DomainDb,
): Promise<T[]> {
  const scope = leadListScope(principal);
  if (scope.assignedId === null) return hits;
  const leadIds = [
    ...new Set(
      hits.flatMap((hit) => (hit.leadId === null ? [] : [hit.leadId])),
    ),
  ];
  if (!leadIds.length) return hits;
  const allowed = new Set(
    (
      await db.lead.findMany({
        select: { id: true },
        where: { assignedId: scope.assignedId, id: { in: leadIds } },
      })
    ).map((lead) => lead.id),
  );
  return hits.filter((hit) => hit.leadId === null || allowed.has(hit.leadId));
}
