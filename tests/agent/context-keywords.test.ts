import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { describe, it } from "vitest";

import {
  addressKeywords,
  keywordScore,
  nameKeywords,
  queryKeywords,
  referenceKeywords,
  suburbOf,
} from "@/lib/domain/agent-context/keywords";
import { searchAgentContext } from "@/lib/domain/agent-context";
import {
  offerSections,
  projectSections,
} from "@/lib/domain/agent-context/text";
import type { DomainDb } from "@/lib/domain/db";
import { userPrincipal } from "@/lib/domain/principal";

// #621: short, spoken or typed-differently descriptions resolve on the first
// try. The classes of miss this fixes: "12 Example Street" for a project saved
// as "12 Example St" (#609), and an offer reference typed in another form
// (#618).

function overlaps(query: string, keywords: readonly string[]) {
  const stored = new Set(keywords);
  return queryKeywords(query).filter((key) => stored.has(key));
}

describe("keywords", () => {
  it("say an address in both street-type forms, with the suburb and lot", () => {
    const keywords = addressKeywords(
      "Lot 1234, 12 Example St, Oran Park NSW 2570",
    );
    for (const expected of [
      "12 example st",
      "12 example street",
      "example st",
      "example street",
      "example",
      "oran park",
      "lot 1234",
      "1234",
    ])
      assert.ok(keywords.includes(expected), expected);
    assert.equal(suburbOf("12 Example St, Oran Park NSW 2570"), "oran park");
  });

  it("say an offer reference with and without its separators and revision", () => {
    assert.deepEqual(referenceKeywords("RC-2026-014", 2).sort(), [
      "rc 2026 014",
      "rc 2026 014 r2",
      "rc2026014",
      "rc2026014r2",
    ]);
  });

  it("say each person of a couple, and their parts", () => {
    const keywords = nameKeywords("Jordan & Sam Smith");
    for (const expected of ["jordan", "sam smith", "smith", "jordan sam smith"])
      assert.ok(keywords.includes(expected), expected);
  });
});

describe("a question matches the forms a record is stored in", () => {
  const project = addressKeywords("12 Example St, Oran Park");

  it('finds "12 Example Street" for a project saved as "12 Example St"', () => {
    assert.ok(
      overlaps("where's 12 Example Street up to?", project).includes(
        "12 example street",
      ),
    );
  });

  it("finds an offer reference typed with spaces or none", () => {
    const offer = referenceKeywords("RC-2026-014", 2);
    assert.ok(overlaps("status of RC 2026 014", offer).length > 0);
    assert.ok(overlaps("rc2026014 sent?", offer).length > 0);
    assert.ok(overlaps("RC-2026-014-R2", offer).length > 0);
  });

  it("ranks a longer matched run, and a number, above one word", () => {
    const keys = queryKeywords("12 Example Street");
    assert.ok(
      keywordScore(keys, ["12 example street"])
        > keywordScore(keys, ["example"]),
    );
  });
});

/** A database whose keyword and name reads behave like Postgres's. */
function indexDb(rows: Record<string, unknown>[]) {
  return {
    $queryRaw: async () => [],
    agentContextChunk: {
      findMany: async (args: {
        where: {
          keywords?: { hasSome: string[] };
          kind: { in: string[] };
          OR?: { title: { contains: string } }[];
          section: { notIn: string[] };
        };
      }) =>
        rows.filter((row) => {
          const { where } = args;
          if (!where.kind.in.includes(row.kind as string)) return false;
          if (where.section.notIn.includes(row.section as string)) return false;
          if (where.keywords)
            return where.keywords.hasSome.some((key) =>
              (row.keywords as string[]).includes(key),
            );
          if (where.OR)
            return where.OR.some((clause) =>
              (row.title as string)
                .toLowerCase()
                .includes(clause.title.contains.toLowerCase()),
            );
          return true;
        }),
    },
  } as unknown as DomainDb;
}

const admin = userPrincipal({ id: "a1", role: Role.ADMIN });

const projectBase = {
  buildingType: "Double storey",
  checklists: [],
  compliance: null,
  council: "Camden",
  customerNames: ["Jordan Smith"],
  estimatedEndDate: new Date("2027-06-01T00:00:00Z"),
  invoices: [],
  leadId: 42,
  milestones: [],
  openVariations: 0,
  siteManagerName: "Sam",
  spent: 0,
  startDate: new Date("2026-09-01T00:00:00Z"),
  status: "ACTIVE",
  totalBudget: 600_000,
  upcomingBookings: [],
};

function rowsOf(drafts: ReturnType<typeof projectSections>) {
  return drafts.map((draft) => ({
    ...draft,
    keywords: [...draft.keywords],
    refreshedAt: new Date(),
    tags: [...draft.tags],
  }));
}

describe("searchAgentContext by keyword, with no embedding at all", () => {
  const rows = [
    ...rowsOf(
      projectSections({
        ...projectBase,
        id: "p-example",
        location: "12 Example St, Oran Park",
        name: "Smith Residence",
      }),
    ),
    ...rowsOf(
      projectSections({
        ...projectBase,
        customerNames: ["Jordan Lee"],
        id: "p-other",
        location: "3 Oak Ave, Kellyville",
        name: "Lee Residence",
      }),
    ),
    ...rowsOf(
      offerSections({
        acceptedAt: null,
        followUps: { count: 0, lastSentAt: null },
        id: "o-1",
        leadId: 42,
        leadName: "Jordan Smith",
        location: "12 Example St, Oran Park",
        projectId: null,
        reference: "RC-2026-014",
        revisionNumber: 2,
        secondaryName: null,
        sentAt: new Date("2026-11-20T00:00:00Z"),
        status: "OFFER_SENT",
        totalAmount: 600_000,
        updatedAt: new Date("2026-11-20T00:00:00Z"),
        validUntil: "2026-12-20",
        valueIncGst: 612_500,
      }),
    ),
  ];
  const db = indexDb(rows);

  it('finds "12 Example Street" first', async () => {
    const hits = await searchAgentContext(
      admin,
      { kinds: ["project"], query: "12 Example Street" },
      db,
    );
    assert.equal(hits[0]?.entityId, "p-example");
  });

  it("finds an offer reference typed with spaces", async () => {
    const hits = await searchAgentContext(
      admin,
      { kinds: ["offer"], query: "RC 2026 014" },
      db,
    );
    assert.equal(hits[0]?.kind, "offer");
    assert.equal(hits[0]?.entityId, "42");
  });

  it("returns every candidate for a first name alone", async () => {
    const hits = await searchAgentContext(
      admin,
      { kinds: ["project"], query: "Jordan" },
      db,
    );
    assert.deepEqual(hits.map((hit) => hit.entityId).sort(), [
      "p-example",
      "p-other",
    ]);
  });

  it("works out overdue when read, from the stored date", async () => {
    const offerRows = rows.filter((row) => row.kind === "offer");
    const [hit] = await searchAgentContext(
      admin,
      { kinds: ["offer"], query: "RC 2026 014" },
      indexDb(offerRows),
      {},
      new Date("2026-12-21T00:00:00Z"),
    );
    assert.equal(hit?.section, "overview");
    assert.equal(hit?.overdue, true, "past its valid-until date");
    assert.doesNotMatch(hit?.content ?? "", /overdue/i);
  });
});
