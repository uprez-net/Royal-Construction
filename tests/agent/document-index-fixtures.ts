import type { DomainDb } from "@/lib/domain/db";
import type { DocumentTextPort } from "@/lib/domain/ports/document-text";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import { systemPrincipal } from "@/lib/domain/principal";

// Uploaded documents in the agent's index: each read once, cut into passages
// tagged with the lead, project and offer it is filed under, embedded, and
// searchable only by staff.

export const LEAD_ID = 42;
export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const OFFER_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
export const cron = systemPrincipal("test");
export const now = new Date("2026-11-13T00:00:00Z");

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

export function fileRow(overrides: Partial<FileRow> & { id: string }): FileRow {
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
export function memoryDb(files: FileRow[], replies: unknown[] = []) {
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
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
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
      findMany: async ({
        where,
      }: {
        where: { urlHash?: { in: string[] }; status?: string };
      }) =>
        where.urlHash
          ? where.urlHash.in.flatMap((key) =>
              texts.has(key) ? [texts.get(key)!] : [],
            )
          : [...texts.values()].filter((row) => row.status === where.status),
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
      findMany: async ({
        where,
      }: { where?: { id?: { in: number[] } } } = {}) =>
        where?.id?.in
          ? where.id.in.includes(LEAD_ID)
            ? [{ id: LEAD_ID, name: "Jordan Smith" }]
            : []
          : [
              {
                id: LEAD_ID,
                name: "Jordan Smith",
                offers: [{ baseReference: "OF-42", id: OFFER_ID }],
                project: { id: PROJECT_ID, name: "12 Rose St" },
              },
            ],
    },
    offer: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(OFFER_ID)
          ? [{ baseReference: "OF-42", id: OFFER_ID, leadId: LEAD_ID }]
          : [],
    },
    offerDocumentReply: { findMany: async () => replies },
    project: {
      findMany: async ({
        where,
      }: { where?: { id?: { in: string[] } } } = {}) =>
        where?.id?.in
          ? [
              { id: PROJECT_ID, name: "12 Rose St" },
              { id: OTHER_PROJECT_ID, name: "Lot 9 Somerville Drive" },
            ].filter((row) => where.id!.in.includes(row.id))
          : [
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

export function reader(
  pagesByUrl: Record<string, string[] | "unsupported" | Error>,
) {
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
export function keywordEmbedding(fail = false) {
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

export const surveyText = [
  "# Bushfire assessment\n\nThe site is rated BAL-29 under AS 3959. Construction must meet the BAL-29 provisions.",
  "# Soil\n\nSite classification: Class M.",
];
