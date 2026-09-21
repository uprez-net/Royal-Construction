import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  authorizeLeadTask,
  authorizeLeadTaskOnLead,
} from "../../lib/domain/leads/tasks";
import { listLeadTasks, searchLeads } from "../../lib/domain/leads/queries";
import { syncLeadStageForOffer } from "../../lib/domain/leads/stage-sync";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "../../lib/domain/errors";
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

test("lead search is filtered by the caller's own scope", async () => {
  const staff = recordingDb({ "lead.findMany": [] });
  await searchLeads(
    adminPrincipal(),
    { includeArchived: false, limit: 10, query: "smith" },
    staff.db,
  );
  const staffWhere = (staff.calls[0].args as { where: Record<string, unknown> })
    .where;
  assert.equal("assignedId" in staffWhere, false, "staff read every lead");
  assert.deepEqual(staffWhere.isArchived, false);

  const scoped = recordingDb({ "lead.findMany": [] });
  await searchLeads(
    customerPrincipal("u_c"),
    { includeArchived: true, limit: 10, query: "smith" },
    scoped.db,
  );
  const scopedWhere = (
    scoped.calls[0].args as { where: Record<string, unknown> }
  ).where;
  assert.equal(scopedWhere.assignedId, "u_c");
  // includeArchived drops the filter rather than inverting it.
  assert.equal("isArchived" in scopedWhere, false);
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
