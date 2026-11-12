import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  authorizeLeadTask,
  authorizeLeadTaskOnLead,
} from "@/lib/domain/leads/tasks";
import { listLeadTasks, searchLeads } from "@/lib/domain/leads/queries";
import { syncLeadStageForOffer } from "@/lib/domain/leads/stage-sync";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "./domain-harness";

// Phase 2 of issue #301: leads.

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/* ------------------------------------------------------- task authorization */

test("a task id from the client is not authorization", async () => {
  // The App task routes used to act on whatever id arrived: PATCH closed any
  // task, DELETE removed any task. Eve checked. One rule now, the stricter one.
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: "u_other", id: 7 },
    "leadTask.findUnique": { leadId: 7 },
  });

  await assert.rejects(
    () => authorizeLeadTask(customerPrincipal("u_c"), 42, recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a task that does not exist is a 404, not a silent success", async () => {
  const recorder = recordingDb({ "leadTask.findUnique": null });
  await assert.rejects(
    () => authorizeLeadTask(adminPrincipal(), 42, recorder.db),
    DomainNotFoundError,
  );
});

test("naming a lead and a task checks the task is actually on that lead", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "leadTask.findUnique": { leadId: 7 },
  });

  // The pair matches.
  assert.deepEqual(
    await authorizeLeadTaskOnLead(adminPrincipal(), 7, 42, recorder.db),
    { leadId: 7, taskId: 42 },
  );

  // The task is readable, but belongs to a different lead than the caller
  // named — which is how a tool call ends up closing the wrong booking.
  const mismatched = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "leadTask.findUnique": { leadId: 7 },
  });
  await assert.rejects(
    () => authorizeLeadTaskOnLead(adminPrincipal(), 99, 42, mismatched.db),
    DomainNotFoundError,
  );
});

/* -------------------------------------------------------------- lead reads */

const leadReads = (rows: unknown[] = [], total = rows.length) => ({
  "lead.count": total,
  "lead.findMany": rows,
  "lead.groupBy": [],
});

type LeadRead = {
  orderBy?: unknown;
  skip?: number;
  take?: number;
  where: Record<string, unknown>;
};
const argsOf = (
  recorder: { calls: readonly { args: unknown; operation: string }[] },
  operation: string,
) =>
  recorder.calls.find((call) => call.operation === operation)!.args as LeadRead;

test("lead search is filtered by the caller's own scope", async () => {
  const staff = recordingDb(leadReads());
  await searchLeads(
    adminPrincipal(),
    { includeArchived: false, limit: 10, page: 1, query: "smith" },
    staff.db,
  );
  const staffWhere = argsOf(staff, "lead.findMany").where;
  assert.equal("assignedId" in staffWhere, false, "staff read every lead");
  assert.deepEqual(staffWhere.isArchived, false);

  const scoped = recordingDb(leadReads());
  await searchLeads(
    customerPrincipal("u_c"),
    { includeArchived: true, limit: 10, page: 1, query: "smith" },
    scoped.db,
  );
  // The page, the total and the stage counts all carry the scope: a count
  // over leads the caller cannot open would leak how many there are.
  for (const operation of ["lead.findMany", "lead.count", "lead.groupBy"]) {
    const where = argsOf(scoped, operation).where;
    assert.equal(where.assignedId, "u_c", operation);
    // includeArchived drops the filter rather than inverting it.
    assert.equal("isArchived" in where, false, operation);
  }
});

test("an empty lead query lists the whole pipeline, a page at a time, with its total", async () => {
  const rows = [{ id: 3 }, { id: 2 }];
  const recorder = recordingDb({
    ...leadReads(rows, 57),
    "lead.groupBy": [
      { stage: "NEW", _count: { _all: 40 } },
      { stage: "QUOTED", _count: { _all: 17 } },
    ],
  });
  const result = await searchLeads(
    adminPrincipal(),
    { includeArchived: false, limit: 25, page: 3, query: "  " },
    recorder.db,
  );

  const page = argsOf(recorder, "lead.findMany");
  // No text filter at all, rather than `contains: ""` on four columns.
  assert.equal("OR" in page.where, false);
  assert.equal(page.skip, 50);
  assert.equal(page.take, 25);
  // Creation order with an id tie-breaker, the app's list default: editing a
  // lead mid-way through paging does not move it, so no row is skipped.
  assert.deepEqual(page.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  // The total is counted over exactly the page's filter.
  assert.deepEqual(argsOf(recorder, "lead.count").where, page.where);

  assert.deepEqual(result, {
    items: rows,
    totalCount: 57,
    countsByStage: { NEW: 40, QUOTED: 17 },
  });
});

test("a stage filter narrows the page and total but not the stage breakdown", async () => {
  const recorder = recordingDb(leadReads());
  await searchLeads(
    adminPrincipal(),
    {
      includeArchived: false,
      limit: 10,
      page: 1,
      query: "smith",
      stages: ["QUOTED", "NEGOTIATING"],
    },
    recorder.db,
  );
  const page = argsOf(recorder, "lead.findMany").where;
  assert.deepEqual(page.stage, { in: ["QUOTED", "NEGOTIATING"] });
  assert.deepEqual(argsOf(recorder, "lead.count").where, page);
  // Everything but the stage filter — scope, archive filter, the query — still
  // applies to the breakdown.
  const withoutStage = { ...page };
  delete withoutStage.stage;
  assert.deepEqual(argsOf(recorder, "lead.groupBy").where, withoutStage);
});

test("listing one lead's tasks authorizes the lead first", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: "u_other", id: 7 },
  });
  await assert.rejects(
    () =>
      listLeadTasks(
        customerPrincipal("u_c"),
        { leadId: 7, limit: 10, state: "open" },
        recorder.db,
      ),
    DomainAuthorizationError,
  );
  // Refused before the tasks were read at all.
  assert.deepEqual(recorder.operations(), ["lead.findUnique"]);
});

test("the task state filter means what it says", async () => {
  for (const [state, expected] of [
    ["open", { equals: null }],
    ["completed", { not: null }],
  ] as const) {
    const recorder = recordingDb({
      "lead.findUnique": { assignedId: null, id: 7 },
      "leadTask.findMany": [],
    });
    await listLeadTasks(
      adminPrincipal(),
      { leadId: 7, limit: 10, state },
      recorder.db,
    );
    const where = (
      recorder.calls[1].args as { where: { completedAt?: unknown } }
    ).where;
    assert.deepEqual(where.completedAt, expected);
  }

  // "all" must not filter at all, rather than filtering on undefined.
  const all = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "leadTask.findMany": [],
  });
  await listLeadTasks(
    adminPrincipal(),
    { leadId: 7, limit: 10, state: "all" },
    all.db,
  );
  const allWhere = (all.calls[1].args as { where: Record<string, unknown> })
    .where;
  assert.equal("completedAt" in allWhere, false);
});

/* --------------------------------------------------------- lead stage sync */

test("the stage write is conditional on the stage it was decided from", async () => {
  const recorder = recordingDb({
    "lead.updateMany": { count: 1 },
    "offer.findUnique": {
      lead: { stage: "DISCOVERY", wonAt: null },
      leadId: 7,
      offerStatus: "ACCEPTED",
    },
  });

  await syncLeadStageForOffer("offer_1", recorder.db as never);

  const write = recorder.writes()[0];
  assert.equal(write.operation, "lead.updateMany");
  // A concurrent stage change wins rather than being clobbered: the lead moved
  // under us, so our projection is stale and the next status change redoes it.
  assert.deepEqual((write.args as { where: unknown }).where, {
    id: 7,
    stage: "DISCOVERY",
  });
});

test("the stage sync never throws, whatever the database does", async () => {
  const recorder = recordingDb({
    "offer.findUnique": () => {
      throw new Error("connection terminated");
    },
  });

  // Its callers rely on this absolutely: the DocuSign webhook calls it after
  // recording a signature, and a throw would report a failed delivery for a
  // signature that is already saved. DocuSign would then retry it.
  await assert.doesNotReject(() =>
    syncLeadStageForOffer("offer_1", recorder.db as never),
  );
});

/* ------------------------------------------------ the move actually happened */

test("lead tasks are a domain module with no ambient client", () => {
  const tasks = read("lib/domain/leads/tasks.ts");
  assert.doesNotMatch(tasks, /from "@\/lib\/prisma"/);
  // The atomicity contract the module was built around, still stated.
  assert.match(tasks, /\$transaction/);
  assert.match(tasks, /recordTaskHistory/);
});

test("the stage-sync rule left its cache call behind in the adapter", () => {
  const domain = read("lib/domain/leads/stage-sync.ts");
  // (The name appears in a comment there explaining why it is not.)
  assert.doesNotMatch(domain, /from "next\/cache"/);
  assert.doesNotMatch(domain, /revalidateTag\(/);
  // revalidateTag throws outside a request, which is what stopped a cron or an
  // Eve tool calling the rule at all.
  assert.match(read("lib/data/sync-lead-stage.ts"), /revalidateTag/);
  assert.match(read("lib/data/sync-lead-stage.ts"), /syncLeadStageDomain/);
});

test("Eve's lead specialist issues no business queries of its own", () => {
  const source = read("agent/lib/lead-operations.ts");
  assert.doesNotMatch(source, /from "@\/lib\/prisma"/);
  assert.match(source, /agentDb/);
  assert.match(source, /@\/lib\/domain\/leads\/queries/);
});

test("the booking route and the app routes call the same task command", () => {
  for (const path of [
    "app/api/graph/book-consultant/route.ts",
    "app/api/(data)/leads/tasks/route.ts",
    "app/api/(data)/leads/tasks/[taskId]/route.ts",
  ]) {
    assert.match(read(path), /@\/lib\/domain\/leads\/tasks/, path);
  }
  // And the task routes now check the caller before acting on an id.
  assert.match(
    read("app/api/(data)/leads/tasks/[taskId]/route.ts"),
    /authorizeLeadTask/,
  );

  const collectionRoute = read("app/api/(data)/leads/tasks/route.ts");
  assert.equal(
    collectionRoute.match(/await requireInternalUser\(\)/g)?.length,
    2,
    "both collection handlers must refuse customer accounts",
  );
});
