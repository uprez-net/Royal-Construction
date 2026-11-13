import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  MAX_EXTRACTION_ATTEMPTS,
  refreshAgentFiles,
  searchAgentFiles,
} from "@/lib/domain/agent-context/files";
import {
  documentPassage,
  loadFileSources,
  replyAttachments,
  urlHash,
  type FileSource,
} from "@/lib/domain/agent-context/file-sources";
import type { DomainDb } from "@/lib/domain/db";
import type { DocumentTextPort } from "@/lib/domain/ports/document-text";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import { systemPrincipal, userPrincipal } from "@/lib/domain/principal";

// Uploaded documents in the agent's index: each read once, cut into passages
// tagged with the lead, project and offer it is filed under, embedded, and
// searchable only by staff.

const LEAD_ID = 42;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";
const cron = systemPrincipal("test");
const now = new Date("2026-11-13T00:00:00Z");

type FileRow = {
  id: string;
  filename: string;
  fileType: string;
  filesize: number;
  url: string;
  tags: string[];
  origin: string | null;
  createdAt: Date;
  leadId: number | null;
  projectId: string | null;
  milestone: { projectId: string } | null;
  complianceDocument: { engagement: { projectId: string } } | null;
};

function fileRow(overrides: Partial<FileRow> & { id: string }): FileRow {
  return {
    complianceDocument: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    filename: `${overrides.id}.pdf`,
    filesize: 1_000,
    fileType: "application/pdf",
    leadId: null,
    milestone: null,
    origin: null,
    projectId: null,
    tags: [],
    url: `https://blob.example/${overrides.id}.pdf`,
    ...overrides,
  };
}

type ChunkRow = {
  id: string;
  sourceKey: string;
  chunkIndex: number;
  fileId: string | null;
  offerReplyId: string | null;
  leadId: number | null;
  projectId: string | null;
  offerId: string | null;
  title: string;
  content: string;
  contentHash: string;
  pageFrom: number;
  pageTo: number;
  refreshedAt: Date;
  updatedAt: Date;
  embedding: number[] | null;
};

type TextRow = {
  urlHash: string;
  status: string;
  reason: string | null;
  pages: string[];
  attempts: number;
};

type SqlLike = {
  strings?: readonly string[];
  sql?: string;
  values?: unknown[];
};

/** The column filters a Prisma.sql fragment carries, e.g. `"leadId" = ?`. */
function sqlFilters(values: unknown[]): [string, unknown][] {
  const filters: [string, unknown][] = [];
  for (const value of values) {
    const fragment = value as SqlLike;
    if (!fragment || typeof fragment !== "object" || !fragment.values) continue;
    const text = fragment.sql ?? fragment.strings?.join("?") ?? "";
    const columns = [...text.matchAll(/"(\w+)" = \?/g)].map((m) => m[1]!);
    columns.forEach((column, index) =>
      filters.push([column, fragment.values![index]]),
    );
  }
  return filters;
}

function contains(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * An in-memory database with one live lead (and its project and offer), the
 * files given, and the two index tables.
 */
function memoryDb(files: FileRow[], replies: unknown[] = []) {
  const chunks = new Map<string, ChunkRow>();
  const texts = new Map<string, TextRow>();
  let nextId = 1;

  const matchesChunkWhere = (
    row: ChunkRow,
    where: Record<string, unknown>,
  ): boolean => {
    if (!where || Object.keys(where).length === 0) return true;
    if (Array.isArray(where.AND))
      return where.AND.every((part) => matchesChunkWhere(row, part as never));
    if (Array.isArray(where.OR))
      return where.OR.some((part) => matchesChunkWhere(row, part as never));
    return Object.entries(where).every(([field, condition]) => {
      const value = row[field as keyof ChunkRow];
      if (condition && typeof condition === "object") {
        const c = condition as {
          in?: unknown[];
          notIn?: unknown[];
          contains?: string;
        };
        if (c.in) return c.in.includes(value);
        if (c.notIn) return !c.notIn.includes(value);
        if (c.contains !== undefined)
          return contains(String(value), c.contains);
      }
      return value === condition;
    });
  };

  const db = {
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("?");
      if (sql.includes('"embedding" = NULL')) {
        const row = chunks.get(values[0] as string);
        if (row) row.embedding = null;
        return row ? 1 : 0;
      }
      const [literal, id, hash] = values as [string, string, string];
      const row = chunks.get(id);
      if (!row || row.contentHash !== hash) return 0;
      row.embedding = JSON.parse(literal) as number[];
      return 1;
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('WHERE "embedding" IS NULL')) {
        return [...chunks.values()]
          .filter((row) => row.embedding === null)
          .map(({ id, content, contentHash }) => ({
            content,
            contentHash,
            id,
          }));
      }
      const query = JSON.parse(values[0] as string) as number[];
      const filters = sqlFilters(values);
      return [...chunks.values()]
        .filter((row) => row.embedding !== null)
        .filter(
          (row) =>
            !filters.length
            || filters.some(
              ([column, value]) => row[column as keyof ChunkRow] === value,
            ),
        )
        .map((row) => ({
          ...row,
          score: row.embedding!.reduce(
            (sum, x, i) => sum + x * (query[i] ?? 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score);
    },
    agentFileChunk: {
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (const row of [...chunks.values()]) {
          if (matchesChunkWhere(row, where)) {
            chunks.delete(row.id);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
      }) =>
        [...chunks.values()]
          .filter((row) => matchesChunkWhere(row, where))
          .slice(0, take ?? Infinity),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<ChunkRow>;
      }) => {
        let count = 0;
        for (const row of chunks.values()) {
          if (matchesChunkWhere(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          sourceKey_chunkIndex: { sourceKey: string; chunkIndex: number };
        };
        create: Omit<ChunkRow, "id" | "embedding" | "updatedAt">;
        update: Partial<ChunkRow>;
      }) => {
        const { sourceKey, chunkIndex } = where.sourceKey_chunkIndex;
        const existing = [...chunks.values()].find(
          (row) => row.sourceKey === sourceKey && row.chunkIndex === chunkIndex,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return { id: existing.id };
        }
        const id = `chunk-${nextId++}`;
        chunks.set(id, {
          ...create,
          embedding: null,
          id,
          updatedAt: new Date(),
        });
        return { id };
      },
    },
    agentFileText: {
      deleteMany: async ({
        where,
      }: {
        where: { urlHash: { notIn: string[] } };
      }) => {
        let count = 0;
        for (const key of [...texts.keys()]) {
          if (!where.urlHash.notIn.includes(key)) {
            texts.delete(key);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({ where }: { where: { urlHash: { in: string[] } } }) =>
        where.urlHash.in.flatMap((key) =>
          texts.has(key) ? [texts.get(key)!] : [],
        ),
      upsert: async ({
        create,
        update,
        where,
      }: {
        create: TextRow;
        update: Partial<TextRow>;
        where: { urlHash: string };
      }) => {
        const existing = texts.get(where.urlHash);
        texts.set(
          where.urlHash,
          existing ? { ...existing, ...update } : create,
        );
        return {};
      },
    },
    contract: { findMany: async () => [] },
    file: { findMany: async () => files },
    lead: {
      findMany: async () => [
        {
          id: LEAD_ID,
          name: "Jordan Smith",
          offers: [{ baseReference: "OF-42", id: OFFER_ID }],
          project: { id: PROJECT_ID, name: "12 Rose St" },
        },
      ],
    },
    offerDocumentReply: { findMany: async () => replies },
    project: {
      findMany: async () => [
        {
          id: PROJECT_ID,
          Lead: {
            id: LEAD_ID,
            name: "Jordan Smith",
            offers: [{ baseReference: "OF-42", id: OFFER_ID }],
          },
          name: "12 Rose St",
        },
      ],
    },
    tender: {
      findMany: async () => [
        {
          executedPdfUrl: "https://blob.example/signed-tender.pdf",
          offerId: OFFER_ID,
        },
      ],
    },
  };
  return { chunks, db: db as unknown as DomainDb, texts };
}

function reader(pagesByUrl: Record<string, string[] | "unsupported" | Error>) {
  const reads: string[] = [];
  const port: DocumentTextPort = {
    extract: async ({ url }) => {
      reads.push(url);
      const result = pagesByUrl[url];
      if (result instanceof Error) throw result;
      if (result === "unsupported" || !result)
        return {
          reason: "Not a kind of file the index reads.",
          status: "unsupported",
        };
      return { pages: result, status: "text" };
    },
  };
  return { port, reads };
}

/** Embeds by keyword, so a search for a word finds the passages that have it. */
function keywordEmbedding(fail = false) {
  const calls: string[][] = [];
  const port: EmbeddingPort = {
    dimensions: 1536,
    embed: async (values) => {
      calls.push([...values]);
      if (fail) throw new Error("gateway down");
      return values.map((value) =>
        Array.from({ length: 1536 }, (_, i) =>
          i === 0 ? 0.1 : i === 1 && /bushfire/i.test(value) ? 1 : 0,
        ),
      );
    },
  };
  return { calls, port };
}

const surveyText = [
  "# Bushfire assessment\n\nThe site is rated BAL-29 under AS 3959. Construction must meet the BAL-29 provisions.",
  "# Soil\n\nSite classification: Class M.",
];

// --- Tagging ---------------------------------------------------------------

test("each document is tagged with its lead, project and offer", async () => {
  const { db } = memoryDb([
    fileRow({ id: "survey", milestone: { projectId: PROJECT_ID } }),
    fileRow({ id: "brief", leadId: LEAD_ID }),
    fileRow({
      id: "signed",
      leadId: LEAD_ID,
      tags: ["Offer", "Signed", "Tender"],
      url: "https://blob.example/signed-tender.pdf",
    }),
  ]);
  const sources = await loadFileSources(db, now);
  const byKey = Object.fromEntries(sources.map((s) => [s.sourceKey, s]));

  // A milestone's file belongs to the project, and so to the lead it came from.
  assert.equal(byKey["file:survey"]?.projectId, PROJECT_ID);
  assert.equal(byKey["file:survey"]?.leadId, LEAD_ID);
  assert.equal(byKey["file:survey"]?.offerId, null);
  // A lead's file follows the lead to its project.
  assert.equal(byKey["file:brief"]?.projectId, PROJECT_ID);
  // The signed Tender names its offer by URL.
  assert.equal(byKey["file:signed"]?.offerId, OFFER_ID);
  assert.equal(byKey["file:signed"]?.offerReference, "OF-42");
});

test("a client's reply attachment is tagged with the offer it answers", async () => {
  const { db } = memoryDb(
    [],
    [
      {
        attachments: [
          {
            contentType: "application/pdf",
            name: "markup.pdf",
            size: 10,
            url: "https://blob.example/markup.pdf",
          },
          {
            contentType: "image/png",
            name: "lost.png",
            note: "too large",
            url: null,
          },
        ],
        fromEmail: "jordan@example.com",
        id: "reply-1",
        receivedAt: new Date("2026-11-10T00:00:00Z"),
        send: {
          offer: { baseReference: "OF-42", id: OFFER_ID, leadId: LEAD_ID },
        },
      },
    ],
  );
  const [source, ...rest] = await loadFileSources(db, now);
  assert.equal(rest.length, 0, "an attachment that was not stored is skipped");
  assert.equal(source?.sourceKey, "offer-reply:reply-1:0");
  assert.equal(source?.offerId, OFFER_ID);
  assert.equal(source?.leadId, LEAD_ID);
  assert.equal(source?.projectId, PROJECT_ID);
  assert.deepEqual(replyAttachments("not a list"), []);
});

test("a compliance line's copy of a document is read once, not twice", async () => {
  const shared = "https://blob.example/title-search.pdf";
  const { db } = memoryDb([
    fileRow({
      createdAt: new Date("2026-11-02T00:00:00Z"),
      id: "copy",
      complianceDocument: { engagement: { projectId: PROJECT_ID } },
      url: shared,
    }),
    fileRow({ id: "original", projectId: PROJECT_ID, url: shared }),
  ]);
  const sources = await loadFileSources(db, now);
  assert.deepEqual(
    sources.map((s) => s.sourceKey),
    ["file:copy"],
  );
});

test("a passage is headed with its document and records, reproducibly", () => {
  const source: FileSource = {
    addedAt: new Date("2026-09-24T14:00:00.000Z"),
    fileId: "survey",
    filename: "Survey.pdf",
    leadId: LEAD_ID,
    leadName: "Jordan Smith",
    mediaType: "application/pdf",
    offerId: null,
    offerReference: null,
    offerReplyId: null,
    origin: "Project › Compliance › Surveyor documents › Survey",
    projectId: PROJECT_ID,
    projectName: "12 Rose St",
    sizeBytes: 1_000,
    sourceKey: "file:survey",
    tags: ["Compliance", "Survey"],
    url: "https://blob.example/survey.pdf",
    urlHash: urlHash("https://blob.example/survey.pdf"),
  };
  assert.equal(
    documentPassage(
      source,
      { pageFrom: 3, pageTo: 4, text: "Rated BAL-29." },
      12,
    ),
    [
      "Document: Survey.pdf (pages 3–4 of 12)",
      "From: Project › Compliance › Surveyor documents › Survey",
      "Tags: Compliance, Survey",
      "For: Project 12 Rose St · Lead Jordan Smith",
      "Added: Fri 25 Sept 2026",
      "",
      "Rated BAL-29.",
      "",
      `Refs: fileId=survey projectId=${PROJECT_ID} leadId=${LEAD_ID}`,
    ].join("\n"),
  );
});

// --- Refresh ---------------------------------------------------------------

test("a new document is read, cut into tagged passages and embedded", async () => {
  const file = fileRow({ id: "survey", projectId: PROJECT_ID });
  const { chunks, db } = memoryDb([file]);
  const read = reader({ [file.url]: surveyText });
  const embedding = keywordEmbedding();

  const result = await refreshAgentFiles(cron, { now }, db, {
    documentText: read.port,
    embedding: embedding.port,
  });

  assert.equal(result.extracted, 1);
  assert.equal(result.embedded, result.passages);
  assert.equal(result.pending, 0);
  assert.ok(chunks.size > 0);
  for (const row of chunks.values()) {
    assert.equal(row.projectId, PROJECT_ID);
    assert.equal(row.leadId, LEAD_ID);
    assert.equal(row.fileId, "survey");
    assert.ok(row.embedding, "every passage has a vector");
    assert.match(row.content, /^Document: survey\.pdf/);
  }
});

test("a document already read is not read or embedded again", async () => {
  const file = fileRow({ id: "survey", projectId: PROJECT_ID });
  const { db } = memoryDb([file]);
  const read = reader({ [file.url]: surveyText });
  const embedding = keywordEmbedding();
  const ports = { documentText: read.port, embedding: embedding.port };

  await refreshAgentFiles(cron, { now }, db, ports);
  const second = await refreshAgentFiles(cron, { now }, db, ports);

  assert.equal(read.reads.length, 1, "OCR runs once per document");
  assert.equal(
    embedding.calls.length,
    1,
    "unchanged passages keep their vectors",
  );
  assert.equal(second.extracted, 0);
  assert.equal(second.embedded, 0);
});

test("an unsupported document is not retried; a failed one is, a bounded number of times", async () => {
  const video = fileRow({
    id: "walkthrough",
    fileType: "video/mp4",
    projectId: PROJECT_ID,
    url: "https://blob.example/walk.mp4",
  });
  const flaky = fileRow({ id: "plans", projectId: PROJECT_ID });
  const { db, texts } = memoryDb([video, flaky]);
  const read = reader({
    [video.url]: "unsupported",
    [flaky.url]: new Error("OCR timed out"),
  });
  const ports = { documentText: read.port, embedding: keywordEmbedding().port };

  for (let run = 0; run < MAX_EXTRACTION_ATTEMPTS + 2; run += 1) {
    await refreshAgentFiles(cron, { now }, db, ports);
  }

  assert.equal(read.reads.filter((url) => url === video.url).length, 1);
  assert.equal(
    read.reads.filter((url) => url === flaky.url).length,
    MAX_EXTRACTION_ATTEMPTS,
  );
  assert.equal(texts.get(urlHash(flaky.url))?.status, "FAILED");
});

test("past the deadline nothing new is read, and the document waits for the next run", async () => {
  const file = fileRow({ id: "survey", projectId: PROJECT_ID });
  const { chunks, db } = memoryDb([file]);
  const read = reader({ [file.url]: surveyText });

  const result = await refreshAgentFiles(
    cron,
    { deadline: new Date(Date.now() - 1), now },
    db,
    { documentText: read.port, embedding: keywordEmbedding().port },
  );

  assert.deepEqual(read.reads, []);
  assert.equal(result.pending, 1);
  assert.equal(chunks.size, 0);
});

test("a document that left the live set loses its passages and its cached text", async () => {
  const file = fileRow({ id: "survey", projectId: PROJECT_ID });
  const files = [file];
  const { chunks, db, texts } = memoryDb(files);
  const ports = {
    documentText: reader({ [file.url]: surveyText }).port,
    embedding: keywordEmbedding().port,
  };
  await refreshAgentFiles(cron, { now }, db, ports);
  assert.ok(chunks.size > 0);

  files.length = 0;
  const result = await refreshAgentFiles(cron, { now }, db, ports);
  assert.equal(chunks.size, 0);
  assert.equal(texts.size, 0);
  assert.ok(result.removed > 0);
});

test("an embedding outage keeps the passages, says so, and the next run embeds them", async () => {
  const file = fileRow({ id: "survey", projectId: PROJECT_ID });
  const { chunks, db } = memoryDb([file]);
  const documentText = reader({ [file.url]: surveyText }).port;

  const down = await refreshAgentFiles(cron, { now }, db, {
    documentText,
    embedding: keywordEmbedding(true).port,
  });
  assert.equal(down.embeddingFailed, true);
  assert.ok(chunks.size > 0);

  const up = await refreshAgentFiles(cron, { now }, db, {
    documentText,
    embedding: keywordEmbedding().port,
  });
  assert.equal(up.embedded, chunks.size);
});

test("only administrators and the system refresh the documents", async () => {
  const { db } = memoryDb([]);
  await assert.rejects(
    refreshAgentFiles(
      userPrincipal({ id: "u1", role: Role.SITE_MANAGER }),
      {},
      db,
    ),
    /administrators/,
  );
});

// --- Search ----------------------------------------------------------------

async function indexedDb() {
  const survey = fileRow({
    filename: "Survey.pdf",
    id: "survey",
    projectId: PROJECT_ID,
  });
  const elsewhere = fileRow({
    filename: "Other job.pdf",
    id: "other",
    leadId: null,
    projectId: PROJECT_ID,
    url: "https://blob.example/other.pdf",
  });
  const memory = memoryDb([survey, elsewhere]);
  await refreshAgentFiles(cron, { now }, memory.db, {
    documentText: reader({
      [survey.url]: surveyText,
      [elsewhere.url]: [
        "Kitchen joinery schedule: two-pac doors, stone benchtop.",
      ],
    }).port,
    embedding: keywordEmbedding().port,
  });
  return memory;
}

test("search finds the passage that answers, by meaning and by word", async () => {
  const { db } = await indexedDb();
  const admin = userPrincipal({ id: "a1", role: Role.ADMIN });

  const byVector = await searchAgentFiles(
    admin,
    { query: "bushfire rating" },
    db,
    {
      embedding: keywordEmbedding().port,
    },
  );
  assert.match(byVector[0]!.content, /BAL-29/);
  assert.equal(byVector[0]!.projectId, PROJECT_ID);

  // With no embedding, the words alone still find it.
  const byWord = await searchAgentFiles(
    admin,
    { query: "joinery benchtop" },
    db,
  );
  assert.match(byWord[0]!.content, /two-pac/);
});

test("search can be narrowed to one job's documents", async () => {
  const { db } = await indexedDb();
  const admin = userPrincipal({ id: "a1", role: Role.ADMIN });
  const hits = await searchAgentFiles(
    admin,
    { leadId: 9_999, query: "bushfire" },
    db,
    { embedding: keywordEmbedding().port },
  );
  assert.deepEqual(hits, [], "no document is filed under that lead");

  const job = await searchAgentFiles(
    admin,
    { leadId: 9_999, projectId: PROJECT_ID, query: "bushfire" },
    db,
    { embedding: keywordEmbedding().port },
  );
  assert.ok(job.length > 0, "a passage filed under any of the ids matches");
  assert.ok(job.every((hit) => hit.projectId === PROJECT_ID));
});

test("documents are for staff only", async () => {
  const { db } = await indexedDb();
  await assert.rejects(
    searchAgentFiles(
      userPrincipal({ customerId: "c1", id: "c1", role: Role.CUSTOMER }),
      { query: "bushfire" },
      db,
    ),
    /staff only/,
  );
  const guest = await searchAgentFiles(
    userPrincipal({ id: "g1", role: Role.GUEST }),
    { query: "bushfire" },
    db,
    { embedding: keywordEmbedding().port },
  );
  assert.ok(guest.length > 0);
});

test("with no OCR key, documents wait unmarked and are read once it is set", async () => {
  const pdf = fileRow({ id: "survey", projectId: PROJECT_ID });
  const sheet = fileRow({
    fileType: "text/csv",
    id: "schedule",
    projectId: PROJECT_ID,
    url: "https://blob.example/schedule.csv",
  });
  const { db, texts } = memoryDb([pdf, sheet]);
  let keySet = false;
  const reads: string[] = [];
  const documentText: DocumentTextPort = {
    extract: async ({ url }) => {
      reads.push(url);
      if (url === pdf.url && !keySet)
        return { reason: "MISTRAL_AI_KEY is not set.", status: "unavailable" };
      return {
        pages: [
          url === pdf.url ? surveyText[0]! : "Slab pour booked for week 3.",
        ],
        status: "text",
      };
    },
  };
  const ports = { documentText, embedding: keywordEmbedding().port };

  // Longer than the retry limit: a missing key must not use up attempts.
  for (let night = 0; night < MAX_EXTRACTION_ATTEMPTS + 1; night += 1) {
    const result = await refreshAgentFiles(cron, { now }, db, ports);
    assert.equal(result.readerUnavailable, true);
    assert.equal(result.pending, 1);
  }
  assert.equal(
    texts.has(urlHash(pdf.url)),
    false,
    "nothing recorded against it",
  );
  assert.equal(
    texts.get(urlHash(sheet.url))?.status,
    "EXTRACTED",
    "other kinds still read",
  );

  keySet = true;
  const after = await refreshAgentFiles(cron, { now }, db, ports);
  assert.equal(after.extracted, 1);
  assert.equal(after.readerUnavailable, false);
  assert.equal(texts.get(urlHash(pdf.url))?.status, "EXTRACTED");
});
