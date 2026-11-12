import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@prisma/client";
import { test } from "vitest";

import officeSkill, { OFFICE_HANDBOOK } from "@/agent/lib/office-handbook";
import houseStyle from "@/agent/lib/house-style-instructions";
import {
  contentHash,
  lexicalBoost,
  normalizeVector,
  queryTerms,
  refreshAgentContext,
  searchAgentContext,
  selectionFor,
} from "@/lib/domain/agent-context";
import {
  leadChunk,
  type LeadContextSource,
} from "@/lib/domain/agent-context/text";
import type { DomainDb } from "@/lib/domain/db";
import { systemPrincipal, userPrincipal } from "@/lib/domain/principal";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import { REPO_ROOT } from "../support/repo-root";

// The office context: what the agent knows before it asks. Its text is built
// without a model, so it has to be exactly reproducible; its search has to
// find "Smith" even when an embedding would not; and it may only ever show a
// caller what that caller's screens would.

const SPECIALISTS = [
  "admin-operations",
  "compliance-operations",
  "lead-operations",
  "offer-operations",
  "project-operations",
  "tradie-operations",
];

const lead: LeadContextSource = {
  activeOffer: {
    contractValueIncGst: 612_500,
    id: "offer-uuid",
    reference: "OF-42",
    revisionNumber: 2,
    sentAt: new Date("2026-11-03T01:00:00Z"),
    status: "OFFER_SENT",
    totalAmount: 600_000,
    updatedAt: new Date("2026-11-04T01:00:00Z"),
  },
  assignedName: "Priya",
  budget: "$600k",
  estimatedStartDate: null,
  estimatedValue: 612_500,
  expectedCloseDate: new Date("2026-12-01T00:00:00Z"),
  followupDate: null,
  followupTime: null,
  id: 42,
  location: "12 Rose St, Kellyville",
  lostReason: null,
  meetingDate: null,
  meetingMode: null,
  meetingTime: null,
  name: "Jordan Smith",
  openTasks: [
    {
      dueDate: new Date("2026-11-14T00:00:00Z"),
      dueTime: "10:00",
      notes: "Chase   signature",
      type: "CALL",
    },
  ],
  project: null,
  recentHistory: [
    {
      action: "Offer sent",
      actionDate: new Date("2026-11-03T01:00:00Z"),
      detail: "Sent R2 with the revised facade.",
      type: "EMAIL",
    },
  ],
  secondaryName: null,
  source: "Website",
  stage: "QUOTED",
  type: ["Double storey"],
  updatedAt: new Date("2026-11-04T01:00:00Z"),
  urgent: false,
};

test("a lead reads the way the office talks about it, reproducibly", () => {
  const chunk = leadChunk(lead);
  assert.equal(chunk.title, "Jordan Smith — 12 Rose St, Kellyville");
  assert.match(chunk.content, /Stage: Quoted/);
  assert.match(
    chunk.content,
    /Offer: OF-42-R2 is Offer sent, \$612,500 inc GST/,
  );
  assert.match(
    chunk.content,
    /Open tasks: Call due .*2026 10:00 — Chase signature/,
  );
  assert.match(
    chunk.content,
    /Refs \(tools only, never show people\): leadId=42 offerId=offer-uuid/,
  );
  // Same record, same words, same hash: an unchanged lead is not re-embedded.
  assert.equal(
    contentHash(leadChunk(lead).content),
    contentHash(chunk.content),
  );
});

test("vectors are normalised so the inner product ranks by cosine", () => {
  const unit = normalizeVector([3, 4]);
  assert.deepEqual(unit, [0.6, 0.8]);
});

test("a name in the request outranks a vaguely similar record", () => {
  const terms = queryTerms("where's the Smith job up to?");
  // Question words and "job" carry no name; "up" is too short to match on.
  assert.deepEqual(terms, ["smith"]);
  assert.ok(
    lexicalBoost(terms, "Jordan Smith — 12 Rose St", "")
      > lexicalBoost(terms, "Lee Nguyen — 3 Oak Ave", "where"),
  );
});

test("an agent write re-indexes exactly the records it named", () => {
  assert.deepEqual(
    selectionFor([
      { id: "42", type: "lead" },
      { id: "p-1", type: "project" },
      { id: "x", type: "lead" },
      { id: "o-1", type: "offer" },
    ]),
    { leadIds: [42], projectIds: ["p-1"], tradieIds: [] },
  );
  assert.equal(selectionFor([{ id: "o-1", type: "offer" }]), null);
});

/** A database that serves one lead and records what the refresh writes. */
function refreshDb(existingHash: string | null, missingVector = false) {
  const writes: string[] = [];
  const db = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      writes.push(
        strings.join("?").includes("NULL") ? "clear-vector" : "set-vector",
      );
      return 1;
    },
    $queryRaw: async () => (missingVector ? [{ id: "row-1" }] : []),
    agentContextChunk: {
      deleteMany: async () => {
        writes.push("delete");
        return { count: 0 };
      },
      findMany: async () =>
        existingHash === null
          ? []
          : [
              {
                contentHash: existingHash,
                entityId: "42",
                id: "row-1",
                kind: "lead",
              },
            ],
      updateMany: async () => {
        writes.push("touch");
        return { count: 1 };
      },
      upsert: async () => {
        writes.push("upsert");
        return { id: "row-1" };
      },
    },
    lead: {
      findMany: async () => [
        {
          ...lead,
          assignedUser: { name: "Priya" },
          history: lead.recentHistory,
          offers: [
            {
              baseReference: "OF-42",
              contractValueIncGst: 612_500,
              id: "offer-uuid",
              offerStatus: "OFFER_SENT",
              revisionNumber: 2,
              sentAt: lead.activeOffer!.sentAt,
              totalAmount: 600_000,
              updatedAt: lead.activeOffer!.updatedAt,
            },
          ],
          tasks: lead.openTasks,
        },
      ],
    },
  };
  return { db: db as unknown as DomainDb, writes };
}

function countingEmbedding(fail = false) {
  const calls: string[][] = [];
  const port: EmbeddingPort = {
    dimensions: 1536,
    embed: async (values) => {
      calls.push([...values]);
      if (fail) throw new Error("gateway down");
      return values.map(() =>
        Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)),
      );
    },
  };
  return { calls, port };
}

const cron = systemPrincipal("test");
const selection = { leadIds: [42] };

test("a new record is written and embedded", async () => {
  const { db, writes } = refreshDb(null);
  const embedding = countingEmbedding();
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: embedding.port,
  });
  assert.deepEqual(writes, ["upsert", "clear-vector", "set-vector"]);
  assert.equal(embedding.calls.length, 1);
  assert.deepEqual(
    {
      embedded: result.embedded,
      embeddingFailed: result.embeddingFailed,
      unchanged: result.unchanged,
    },
    { embedded: 1, embeddingFailed: false, unchanged: 0 },
  );
});

test("an unchanged record is not re-embedded", async () => {
  const { db, writes } = refreshDb(contentHash(leadChunk(lead).content));
  const embedding = countingEmbedding();
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: embedding.port,
  });
  assert.deepEqual(writes, ["touch"]);
  assert.equal(embedding.calls.length, 0);
  assert.equal(result.unchanged, 1);
});

test("an embedding outage keeps the text and says so", async () => {
  const { db, writes } = refreshDb(null);
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: countingEmbedding(true).port,
  });
  assert.deepEqual(writes, ["upsert", "clear-vector"]);
  assert.equal(result.embeddingFailed, true);
});

test("a record that left the live set loses its row", async () => {
  const { db, writes } = refreshDb("old-hash");
  (
    db as unknown as { lead: { findMany: () => Promise<unknown[]> } }
  ).lead.findMany = async () => [];
  const result = await refreshAgentContext(cron, { selection }, db, {});
  assert.deepEqual(writes, ["delete"]);
  assert.equal(result.removed, 1);
});

test("only administrators and the system rebuild the index", async () => {
  const { db } = refreshDb(null);
  await assert.rejects(
    refreshAgentContext(
      userPrincipal({ id: "u1", role: Role.SITE_MANAGER }),
      { selection },
      db,
    ),
    /administrators/,
  );
});

test("search ranks by inner product plus name match, and refuses customers", async () => {
  const db = {
    $queryRaw: async () => [
      {
        content: "Lead: Lee Nguyen",
        entityId: "7",
        kind: "lead",
        refreshedAt: new Date(),
        score: 0.42,
        title: "Lee Nguyen — 3 Oak Ave",
      },
      {
        content: "Lead: Jordan Smith",
        entityId: "42",
        kind: "lead",
        refreshedAt: new Date(),
        score: 0.4,
        title: "Jordan Smith — 12 Rose St",
      },
    ],
    agentContextChunk: { findMany: async () => [] },
  } as unknown as DomainDb;
  const admin = userPrincipal({ id: "u1", role: Role.ADMIN });
  const hits = await searchAgentContext(admin, { query: "Smith" }, db, {
    embedding: countingEmbedding().port,
  });
  assert.equal(hits[0]?.entityId, "42");

  await assert.rejects(
    searchAgentContext(
      userPrincipal({ customerId: "c1", id: "u2", role: Role.CUSTOMER }),
      { query: "Smith" },
      db,
    ),
    /staff only/,
  );
});

test("every agent shares one handbook and one house style", () => {
  assert.match(OFFICE_HANDBOOK, /Leads — the start of every job/);
  assert.match(OFFICE_HANDBOOK, /Milestones/);
  assert.ok(officeSkill);
  assert.ok(houseStyle);
  for (const name of SPECIALISTS) {
    const skill = readFileSync(
      path.join(
        REPO_ROOT,
        "agent",
        "subagents",
        name,
        "skills",
        "office-assistant.ts",
      ),
      "utf8",
    );
    assert.match(
      skill,
      /from "@\/agent\/lib\/office-handbook"/,
      `${name} skill`,
    );
    const style = readFileSync(
      path.join(
        REPO_ROOT,
        "agent",
        "subagents",
        name,
        "instructions",
        "house-style.ts",
      ),
      "utf8",
    );
    assert.match(
      style,
      /from "@\/agent\/lib\/house-style-instructions"/,
      `${name} style`,
    );
  }
});
