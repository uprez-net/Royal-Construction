import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  MAX_EXTRACTION_ATTEMPTS,
  listUnreadDocuments,
  refreshAgentFiles,
} from "@/lib/domain/agent-context/files";
import { urlHash } from "@/lib/domain/agent-context/file-sources";
import type { DomainDb } from "@/lib/domain/db";
import type { DocumentTextPort } from "@/lib/domain/ports/document-text";
import { userPrincipal } from "@/lib/domain/principal";

import {
  LEAD_ID,
  PROJECT_ID,
  cron,
  fileRow,
  keywordEmbedding,
  memoryDb,
  now,
  reader,
  surveyText,
} from "./document-index-fixtures";

// Reading, cutting and embedding the live documents each night.

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
  // Later nights, as the cron really runs: nothing in a passage depends on the
  // clock, so the same document hashes the same however long it has been.
  const night = 24 * 60 * 60 * 1000;
  const second = await refreshAgentFiles(
    cron,
    { now: new Date(now.getTime() + night) },
    db,
    ports,
  );
  const third = await refreshAgentFiles(
    cron,
    { now: new Date(now.getTime() + 30 * night) },
    db,
    ports,
  );

  assert.equal(read.reads.length, 1, "OCR runs once per document");
  assert.equal(
    embedding.calls.length,
    1,
    "unchanged passages keep their vectors",
  );
  for (const run of [second, third]) {
    assert.equal(run.extracted, 0);
    assert.equal(run.embedded, 0);
  }
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

  // #432: the failure is named for the office digest, not only logged.
  assert.deepEqual(await listUnreadDocuments(db, now), [
    { filename: "plans.pdf", gaveUp: true, record: "12 Rose St" },
  ]);
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

test("a removed document stops answering even when the rest of the run fails", async () => {
  const survey = fileRow({ id: "survey", projectId: PROJECT_ID });
  const files = [survey];
  const { chunks, db, texts } = memoryDb(files);
  const documentText = reader({
    [survey.url]: surveyText,
    "https://blob.example/plans.pdf": surveyText,
  }).port;
  await refreshAgentFiles(cron, { now }, db, {
    documentText,
    embedding: keywordEmbedding().port,
  });
  assert.ok(chunks.size > 0);

  // The survey goes and a new document arrives; writing the new one's
  // passages fails. The survey must already be gone by then.
  files.splice(
    0,
    files.length,
    fileRow({ id: "plans", projectId: PROJECT_ID }),
  );
  const failing = {
    ...db,
    agentFileChunk: {
      ...(db as unknown as { agentFileChunk: object }).agentFileChunk,
      upsert: async () => {
        throw new Error("database unavailable");
      },
    },
  } as unknown as DomainDb;
  await assert.rejects(
    refreshAgentFiles(cron, { now }, failing, {
      documentText,
      embedding: keywordEmbedding().port,
    }),
    /database unavailable/,
  );

  assert.equal(chunks.size, 0, "the removed survey's passages are gone");
  assert.equal(texts.has(urlHash(survey.url)), false, "so is its cached text");
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

test("a document's older copy keeps answering until the newer copy's passages are written", async () => {
  // A compliance line copies a File row onto the same blob; the newer row is
  // the one the index keeps. Swept up front, the older row's passages would be
  // gone before the copy's were written, and a failed write would leave the
  // document with none.
  const shared = "https://blob.example/title-search.pdf";
  const original = fileRow({
    createdAt: new Date("2026-11-01T00:00:00Z"),
    id: "original",
    projectId: PROJECT_ID,
    url: shared,
  });
  const copy = fileRow({
    complianceDocument: { engagement: { projectId: PROJECT_ID } },
    createdAt: new Date("2026-11-02T00:00:00Z"),
    id: "copy",
    url: shared,
  });
  const files = [original];
  const { chunks, db } = memoryDb(files);
  const ports = {
    documentText: reader({ [shared]: surveyText }).port,
    embedding: keywordEmbedding().port,
  };
  await refreshAgentFiles(cron, { now }, db, ports);
  assert.ok(chunks.size > 0);
  assert.ok([...chunks.values()].every((c) => c.sourceKey === "file:original"));

  files.splice(0, files.length, copy, original);
  const failing = {
    ...db,
    agentFileChunk: {
      ...(db as unknown as { agentFileChunk: object }).agentFileChunk,
      upsert: async () => {
        throw new Error("database unavailable");
      },
    },
  } as unknown as DomainDb;
  await assert.rejects(
    refreshAgentFiles(cron, { now }, failing, ports),
    /database unavailable/,
  );
  assert.ok(chunks.size > 0, "the document still answers");
  assert.ok([...chunks.values()].every((c) => c.sourceKey === "file:original"));

  await refreshAgentFiles(cron, { now }, db, ports);
  assert.ok(chunks.size > 0);
  assert.ok(
    [...chunks.values()].every((c) => c.sourceKey === "file:copy"),
    "once the copy is written the older row's passages are retired",
  );
});

test("a refresh queued behind another loads the live set only after it finishes", async () => {
  // The first run reads slowly. A document is removed while it does, and a
  // second run starts. If the second loaded its live set and swept at once, the
  // first would then write the removed document's passages back.
  const survey = fileRow({ id: "survey", projectId: PROJECT_ID });
  const files = [survey];
  const memory = memoryDb(files);
  let loads = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const db = {
    ...memory.db,
    $transaction: (run: (tx: DomainDb) => Promise<unknown>) => {
      // What the database's advisory lock does: one holder at a time.
      const turn = queue.then(() => run(memory.db));
      queue = turn.catch(() => undefined);
      return turn;
    },
    file: {
      findMany: async () => {
        loads += 1;
        return files;
      },
    },
  } as unknown as DomainDb;

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  const documentText: DocumentTextPort = {
    extract: async () => {
      started = true;
      await gate;
      return { pages: surveyText, status: "text" };
    },
  };
  const ports = { documentText, embedding: keywordEmbedding().port };

  const first = refreshAgentFiles(cron, { now }, db, ports);
  while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
  files.length = 0;
  const second = refreshAgentFiles(cron, { now }, db, ports);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(loads, 1, "the second run waits before it loads anything");

  release();
  await Promise.all([first, second]);
  assert.equal(loads, 2);
  assert.equal(
    memory.chunks.size,
    0,
    "the removed document is not written back",
  );
  assert.equal(memory.texts.size, 0);
});
