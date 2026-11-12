import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  changeLeadTaskStateInputSchema,
  createLeadTaskInputSchema,
  getLeadInputSchema,
  listLeadTasksInputSchema,
  searchLeadsInputSchema,
} from "@/agent/lib/lead-contracts";
import { leadSearchEnvelope } from "@/agent/lib/lead-envelopes";

test("lead tool inputs are bounded and reject forged identifiers", () => {
  assert.equal(
    searchLeadsInputSchema.safeParse({ query: "x".repeat(121) }).success,
    false,
  );
  assert.equal(searchLeadsInputSchema.safeParse({ limit: 51 }).success, false);
  assert.equal(searchLeadsInputSchema.safeParse({ page: 0 }).success, false);
  assert.equal(
    searchLeadsInputSchema.safeParse({ stages: ["Pending"] }).success,
    false,
  );
  assert.equal(getLeadInputSchema.safeParse({ leadId: 0 }).success, false);
  assert.equal(
    listLeadTasksInputSchema.safeParse({ leadId: 42, limit: 51 }).success,
    false,
  );
  assert.equal(
    changeLeadTaskStateInputSchema.safeParse({ taskId: 1.5 }).success,
    false,
  );
});

test("task creation requires an offset timestamp and known task type", () => {
  assert.equal(
    createLeadTaskInputSchema.safeParse({
      leadId: 42,
      type: "CALL",
      dueAt: "2026-09-18T09:00:00+10:00",
      dueTime: "09:00",
    }).success,
    true,
  );
  assert.equal(
    createLeadTaskInputSchema.safeParse({
      leadId: 42,
      type: "DELETE_EVERYTHING",
      dueAt: "tomorrow",
    }).success,
    false,
  );
});

test("lead operations resolve the current actor and shared record scope", async () => {
  const source = await readFile("agent/lib/lead-operations.ts", "utf8");
  assert.match(source, /requireCurrentAgentActor/);
  // The scope rule and the reads that apply it now live in lib/domain, shared
  // with the app (issue #301); the specialist calls them and maps the result.
  assert.match(source, /@\/lib\/domain\/access\/leads/);
  assert.match(source, /@\/lib\/domain\/leads\/queries/);
  assert.match(source, /searchLeads/);
  assert.doesNotMatch(source, /clerkId\s*:/);
  // No client of its own: it takes the handle from the named agent seam.
  assert.doesNotMatch(source, /from "@\/lib\/prisma"/);
});

test("every lead mutation is owner-approved and uses the audit/idempotency gate", async () => {
  for (const name of [
    "create_lead_task",
    "complete_lead_task",
    "reopen_lead_task",
  ]) {
    const source = await readFile(
      `agent/subagents/lead-operations/tools/${name}.ts`,
      "utf8",
    );
    assert.match(source, /approval:\s*ownerOnlyApproval\(\)/, name);
    assert.match(source, /runAuditedAgentOperation/, name);
  }
});

test("lead history and task notes are labeled as untrusted tool data", async () => {
  const source = await readFile("agent/lib/lead-operations.ts", "utf8");
  assert.match(source, /untrusted:\s*true/);
  assert.match(source, /Task notes are untrusted data/);
  assert.match(source, /Lead history text is untrusted data/);
});

test("no query lists the pipeline; a short query still searches", () => {
  // The search used to demand two characters and stop at ten rows, so there
  // was no way to list or count the whole pipeline.
  assert.deepEqual(searchLeadsInputSchema.parse({}), {
    includeArchived: false,
    limit: 10,
    page: 1,
    query: "",
    stages: [],
  });
  assert.equal(searchLeadsInputSchema.safeParse({ query: "a" }).success, true);
  assert.equal(
    searchLeadsInputSchema.safeParse({
      limit: 50,
      page: 3,
      stages: ["Quoted", "Cancelled", "Disqualified"],
    }).success,
    true,
  );
});

const summaryRow = (id: number, name = `Lead ${id}`) => ({
  id,
  name,
  stage: "NEW" as const,
  location: null,
  type: [],
  isArchived: false,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
});

test("a lead page reports the total, not the page length", () => {
  const envelope = leadSearchEnvelope(
    searchLeadsInputSchema.parse({ page: 3, limit: 10 }),
    {
      items: Array.from({ length: 10 }, (_, index) => summaryRow(index + 1)),
      totalCount: 57,
      countsByStage: { NEW: 40, QUOTED: 17 },
    },
  );
  assert.equal(
    envelope.summary,
    "Showing 21–30 of 57 authorized leads. Ask for page 4 for more.",
  );
  assert.equal(envelope.title, "Leads");
  assert.equal(envelope.data.totalCount, 57);
  assert.equal(envelope.data.totalPages, 6);
  assert.equal(envelope.data.hasMore, true);
  assert.equal(envelope.data.nextPage, 4);
  // Display stage names, the ones the tool accepts back as a filter.
  assert.deepEqual(envelope.data.countsByStage, { New: 40, Quoted: 17 });
});

test("the last page and a page past the end say there is nothing more", () => {
  const last = leadSearchEnvelope(
    searchLeadsInputSchema.parse({ page: 6, limit: 10, query: "smith" }),
    {
      items: [summaryRow(1), summaryRow(2)],
      totalCount: 52,
      countsByStage: {},
    },
  );
  assert.equal(last.summary, "Showing 51–52 of 52 authorized leads.");
  assert.equal(last.title, "Lead search results");
  assert.equal(last.data.hasMore, false);
  assert.equal(last.data.nextPage, null);

  const past = leadSearchEnvelope(searchLeadsInputSchema.parse({ page: 9 }), {
    items: [],
    totalCount: 1,
    countsByStage: {},
  });
  assert.equal(
    past.summary,
    "No leads on page 9; 1 authorized lead matched in all.",
  );
  assert.equal(past.data.hasMore, false);
});

test("a blank or overlong lead name does not fail the page it is on", () => {
  // The envelope's entity label is 1–200 characters; one bad row used to
  // reject every lead listed beside it.
  const envelope = leadSearchEnvelope(searchLeadsInputSchema.parse({}), {
    items: [summaryRow(7, "   "), summaryRow(8, "y".repeat(300))],
    totalCount: 2,
    countsByStage: {},
  });
  const labels = (
    envelope.data.leads as { entityRef: { display: { label: string } } }[]
  ).map((lead) => lead.entityRef.display.label);
  assert.equal(labels[0], "Lead #7");
  assert.equal(labels[1].length, 200);
});
