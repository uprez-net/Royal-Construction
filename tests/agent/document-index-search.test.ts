import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  filedUnderLabels,
  isFiledUnderAnotherRecord,
  refreshAgentFiles,
  searchAgentFiles,
} from "@/lib/domain/agent-context/files";
import { userPrincipal } from "@/lib/domain/principal";

import {
  LEAD_ID,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  cron,
  fileRow,
  keywordEmbedding,
  memoryDb,
  now,
  reader,
  surveyText,
} from "./document-index-fixtures";

// Finding the passage that answers, for staff, among the indexed documents.

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

test("each hit names the records its document is filed under", async () => {
  const { db } = await indexedDb();
  const admin = userPrincipal({ id: "a1", role: Role.ADMIN });
  const hits = await searchAgentFiles(admin, { query: "bushfire" }, db, {
    embedding: keywordEmbedding().port,
  });
  assert.ok(hits.length > 0);
  const survey = hits[0]!;
  assert.deepEqual(filedUnderLabels(survey.filedUnder), [
    "Lead: Jordan Smith",
    "Project: 12 Rose St",
  ]);
});

test("a hit filed under a different project is labelled with its own record", async () => {
  const memory = await indexedDb();
  const admin = userPrincipal({ id: "a1", role: Role.ADMIN });
  // The same lead's passage in this job, and another project's contract that
  // also mentions the word: a search for the lead and the right project only
  // ever asks about 12 Rose St.
  memory.chunks.set("elsewhere-chunk", {
    chunkIndex: 0,
    content: "Contract for Lot 9: bushfire attack level BAL-12.5.",
    contentHash: "x",
    embedding: [1, 0, 0],
    fileId: null,
    id: "elsewhere-chunk",
    leadId: LEAD_ID,
    offerId: null,
    offerReplyId: null,
    pageFrom: 1,
    pageTo: 1,
    projectId: OTHER_PROJECT_ID,
    refreshedAt: now,
    sourceKey: "file:contract",
    title: "Contract.pdf · Lot 9 Somerville Drive",
    updatedAt: now,
  });
  const request = { leadId: LEAD_ID, projectId: PROJECT_ID, query: "bushfire" };
  const hits = await searchAgentFiles(admin, request, memory.db, {
    embedding: keywordEmbedding().port,
  });
  const contract = hits.find((hit) => hit.sourceKey === "file:contract");
  assert.ok(contract, "it matches the lead id, so the search returns it");
  assert.deepEqual(filedUnderLabels(contract.filedUnder), [
    "Lead: Jordan Smith",
    "Project: Lot 9 Somerville Drive",
  ]);
  assert.equal(isFiledUnderAnotherRecord(contract, request), true);
  const own = hits.find((hit) => hit.projectId === PROJECT_ID);
  assert.ok(own);
  assert.equal(isFiledUnderAnotherRecord(own, request), false);
  // With nothing asked about, nothing is "another" job's.
  assert.equal(isFiledUnderAnotherRecord(contract, {}), false);
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
  // Access pending (GUEST) is not staff, so it reads no documents either.
  await assert.rejects(
    searchAgentFiles(
      userPrincipal({ id: "g1", role: Role.GUEST }),
      { query: "bushfire" },
      db,
      { embedding: keywordEmbedding().port },
    ),
    /staff only/,
  );
});
