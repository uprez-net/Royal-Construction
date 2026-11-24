import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@prisma/client";
import { test } from "vitest";

import { OFFICE_HANDBOOK } from "@/agent/lib/office-handbook";
import houseStyle from "@/agent/lib/house-style-instructions";
import {
  contentHash,
  draftHash,
  lexicalBoost,
  normalizeVector,
  queryTerms,
  refreshAgentContext,
  searchAgentContext,
  selectionFor,
} from "@/lib/domain/agent-context";
import {
  leadSections,
  offerSections,
  type LeadContextSource,
  type OfferContextSource,
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

test("a lead reads the way the office talks about it, a section at a time, reproducibly", () => {
  const sections = leadSections(lead);
  const by = Object.fromEntries(sections.map((s) => [s.section, s]));
  assert.deepEqual(Object.keys(by).sort(), [
    "comms",
    "money",
    "overview",
    "people",
    "tasks",
  ]);
  for (const section of sections) {
    assert.equal(section.title, "Jordan Smith — 12 Rose St, Kellyville");
    // The header is repeated, so a section found alone says whose it is.
    assert.match(
      section.content,
      /^Lead: Jordan Smith — 12 Rose St, Kellyville \(Quoted\)/,
    );
    assert.match(
      section.content,
      /Refs \(tools only, never show people\): leadId=42 offerId=offer-uuid/,
    );
  }
  // The overview names the offer; only the money section prices it.
  assert.match(by.overview!.content, /Offer: OF-42-R2 is Offer sent/);
  assert.doesNotMatch(by.overview!.content, /\$/);
  assert.match(by.money!.content, /\$612,500 inc GST/);
  assert.match(by.tasks!.content, /- Call due .*2026 10:00 — Chase signature/);
  // A date, not "overdue": that is decided when the index is read.
  assert.equal(by.tasks!.dueAt?.toISOString(), "2026-11-14T00:00:00.000Z");
  assert.doesNotMatch(by.tasks!.content, /overdue/i);
  // Keywords in the forms people say them.
  for (const keyword of [
    "jordan smith",
    "smith",
    "12 rose st",
    "12 rose street",
    "kellyville",
    "of 42 r2",
    "of42r2",
  ])
    assert.ok(by.overview!.keywords.includes(keyword), keyword);
  assert.ok(by.overview!.tags.includes("stage:quoted"));
  assert.ok(by.overview!.tags.includes("suburb:kellyville"));
  // Same record, same words, same hash: an unchanged lead is not re-embedded.
  assert.deepEqual(
    leadSections(lead).map((s) => contentHash(s.content)),
    sections.map((s) => contentHash(s.content)),
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
const LEAD_SECTIONS = leadSections(lead);
const SECTION_COUNT = LEAD_SECTIONS.length;

function repeat<T>(values: readonly T[], times: number): T[] {
  return Array.from({ length: times }, () => values).flat();
}

/**
 * `existing`: "none", "current" (every section already indexed with its
 * current text) or "stale" (one old row the refresh must replace).
 */
function refreshDb(
  existing: "none" | "current" | "stale",
  missingVector = false,
  /** Rows a vector write matches: 0 when the text changed underneath it. */
  vectorRows = 1,
) {
  const writes: string[] = [];
  const db = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("NULL")) {
        writes.push("clear-vector");
        return 1;
      }
      writes.push(
        sql.includes('"contentHash"')
          ? "set-vector-if-same-text"
          : "set-vector",
      );
      return vectorRows;
    },
    $queryRaw: async () => (missingVector ? [{ id: "row-1" }] : []),
    agentContextChunk: {
      deleteMany: async () => {
        writes.push("delete");
        return { count: 0 };
      },
      findMany: async () =>
        existing === "none"
          ? []
          : existing === "stale"
            ? [
                {
                  contentHash: "old-hash",
                  entityId: "42",
                  id: "row-1",
                  kind: "lead",
                  section: "record",
                },
              ]
            : LEAD_SECTIONS.map((draft, index) => ({
                contentHash: draftHash(draft),
                entityId: "42",
                id: `row-${index}`,
                kind: "lead",
                section: draft.section,
              })),
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
    // The lead's offer is its own record now (#621); none in this fixture.
    offer: { findMany: async () => [] },
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

test("a new record is written and embedded, a section at a time", async () => {
  const { db, writes } = refreshDb("none");
  const embedding = countingEmbedding();
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: embedding.port,
  });
  assert.deepEqual(writes, [
    ...repeat(["upsert", "clear-vector"], SECTION_COUNT),
    ...repeat(["set-vector-if-same-text"], SECTION_COUNT),
  ]);
  assert.equal(embedding.calls.length, 1);
  assert.deepEqual(
    {
      embedded: result.embedded,
      embeddingFailed: result.embeddingFailed,
      skipped: result.skipped,
      unchanged: result.unchanged,
    },
    {
      embedded: SECTION_COUNT,
      embeddingFailed: false,
      skipped: 0,
      unchanged: 0,
    },
  );
  assert.equal(typeof result.durationMs, "number");
});

test("an unchanged record is not re-embedded", async () => {
  const { db, writes } = refreshDb("current");
  const embedding = countingEmbedding();
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: embedding.port,
  });
  assert.deepEqual(writes, ["touch"]);
  assert.equal(embedding.calls.length, 0);
  assert.equal(result.unchanged, SECTION_COUNT);
  assert.equal(result.skipped, SECTION_COUNT);
});

test("an embedding outage keeps the text and says so", async () => {
  const { db, writes } = refreshDb("none");
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: countingEmbedding(true).port,
  });
  assert.deepEqual(writes, repeat(["upsert", "clear-vector"], SECTION_COUNT));
  assert.equal(result.embeddingFailed, true);
});

test("a pre-section row is replaced by the record's sections", async () => {
  const { db, writes } = refreshDb("stale");
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: countingEmbedding().port,
  });
  assert.ok(writes.includes("delete"), "the old `record` row is removed");
  assert.equal(result.removed, 1);
});

test("a record that left the live set loses its row", async () => {
  const { db, writes } = refreshDb("stale");
  (
    db as unknown as { lead: { findMany: () => Promise<unknown[]> } }
  ).lead.findMany = async () => [];
  const result = await refreshAgentContext(cron, { selection }, db, {});
  assert.deepEqual(writes, ["delete"]);
  assert.equal(result.removed, 1);
});

test("only administrators and the system rebuild the index", async () => {
  const { db } = refreshDb("none");
  await assert.rejects(
    refreshAgentContext(
      userPrincipal({ id: "u1", role: Role.SITE_MANAGER }),
      { selection },
      db,
    ),
    /administrators/,
  );
});

const SECTION_ROW = {
  dueAt: null,
  keywords: [] as string[],
  refreshedAt: new Date(),
  section: "overview",
  tags: [] as string[],
};

test("search ranks by inner product plus name match, and refuses customers", async () => {
  const db = {
    $queryRaw: async () => [
      {
        ...SECTION_ROW,
        content: "Lead: Lee Nguyen",
        entityId: "7",
        kind: "lead",
        score: 0.42,
        title: "Lee Nguyen — 3 Oak Ave",
      },
      {
        ...SECTION_ROW,
        content: "Lead: Jordan Smith",
        entityId: "42",
        kind: "lead",
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
  assert.ok(houseStyle);
  for (const name of SPECIALISTS) {
    // Carried as instructions since #619, not loaded as a skill.
    const handbook = readFileSync(
      path.join(
        REPO_ROOT,
        "agent",
        "subagents",
        name,
        "instructions",
        "handbook.ts",
      ),
      "utf8",
    );
    assert.match(
      handbook,
      /from "@\/agent\/lib\/office-handbook"/,
      `${name} handbook`,
    );
    assert.equal(
      existsSync(path.join(REPO_ROOT, "agent", "subagents", name, "skills")),
      false,
      `${name} has no skills to load: its procedures are instructions (#619)`,
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

test("a vector is not written over text that changed while it was made", async () => {
  const { db } = refreshDb("none", false, 0);
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: countingEmbedding().port,
  });
  assert.equal(result.embedded, 0);
  assert.equal(result.embeddingFailed, false);
});

test("a vector of the wrong size is reported as a failure", async () => {
  const { db, writes } = refreshDb("none");
  const result = await refreshAgentContext(cron, { selection }, db, {
    embedding: {
      dimensions: 1536,
      embed: async (values) => values.map(() => [1, 0]),
    },
  });
  assert.deepEqual(writes, repeat(["upsert", "clear-vector"], SECTION_COUNT));
  assert.equal(result.embeddingFailed, true);
});

test("restricted staff see only what their screens show, by vector and by name", async () => {
  const tradie = {
    ...SECTION_ROW,
    section: "record",
    content: "Tradie: Dave Smith",
    entityId: "t-1",
    kind: "tradie",
    refreshedAt: new Date(),
    title: "Dave Smith",
  };
  const leadRow = {
    ...SECTION_ROW,
    content: "Lead: Jordan Smith",
    entityId: "42",
    kind: "lead",
    refreshedAt: new Date(),
    title: "Jordan Smith — 12 Rose St",
  };
  const db = {
    $queryRaw: async () => [
      { ...tradie, score: 0.5 },
      { ...leadRow, score: 0.4 },
    ],
    agentContextChunk: { findMany: async () => [tradie, leadRow] },
  } as unknown as DomainDb;
  // Access pending (GUEST) is not staff, so it reads neither leads nor tradies.
  const guest = userPrincipal({ id: "g1", role: Role.GUEST });

  for (const embedding of [countingEmbedding().port, undefined]) {
    await assert.rejects(
      searchAgentContext(guest, { query: "Smith" }, db, { embedding }),
      /staff only/,
    );
  }

  const admin = userPrincipal({ id: "a1", role: Role.ADMIN });
  const adminHits = await searchAgentContext(admin, { query: "Smith" }, db, {});
  assert.deepEqual(adminHits.map((hit) => hit.kind).sort(), ["lead", "tradie"]);
});

test("an offer valid until a day lapses at the next Sydney midnight, in AEDT and AEST", () => {
  const offer = (validUntil: string): OfferContextSource => ({
    acceptedAt: null,
    followUps: { count: 0, lastSentAt: null },
    id: "o-1",
    leadId: 9,
    leadName: "Lee Lead",
    location: "12 Example St",
    projectId: null,
    reference: "RC-2026-014",
    revisionNumber: 2,
    secondaryName: null,
    sentAt: null,
    status: "OFFER_SENT",
    totalAmount: 1,
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    validUntil,
    valueIncGst: null,
  });
  const dueAt = (validUntil: string) =>
    offerSections(offer(validUntil)).find((s) => s.section === "overview")
      ?.dueAt;
  // AEDT (UTC+11): midnight starting 1 Dec 2026 in Sydney.
  assert.deepEqual(dueAt("2026-11-30"), new Date("2026-11-30T13:00:00Z"));
  // AEST (UTC+10): midnight starting 1 Jul 2026 in Sydney.
  assert.deepEqual(dueAt("2026-06-30"), new Date("2026-06-30T14:00:00Z"));
});
