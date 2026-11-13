import assert from "node:assert/strict";
import { test } from "vitest";

import { loadOfficeDigest } from "@/lib/domain/agent-context/sources";
import { listOverdueLeadTasks } from "@/lib/domain/leads/queries";
import { systemPrincipal } from "@/lib/domain/principal";
import { LIVE_LEAD, overdueLeadTaskWhere } from "@/lib/leads/followup-due";
import { recordingDb } from "../architecture/domain-harness";

// #429: the weekly overview led with "Waiting for Richard Sutherland — due Sun
// 8 Feb 2026" on a Lost lead, and offered to clear it. Overdue work and this
// week's meetings are live work, so they read through LIVE_LEAD exactly as the
// Follow-ups tab and the reminder crons do.

function digestDb() {
  return recordingDb({
    "lead.groupBy": [],
    "offer.groupBy": [],
    "project.groupBy": [],
    "leadTask.findMany": [],
    "lead.findMany": [],
    "offer.findMany": [],
    "project.findMany": [],
    "complianceAlert.count": 0,
    "invoice.aggregate": { _count: { _all: 0 }, _sum: { amountDue: null } },
  });
}

test("overdue tasks on closed or archived leads stay out of the digest", async () => {
  const recorder = digestDb();
  await loadOfficeDigest(recorder.db, new Date("2026-11-13T02:00:00Z"));

  const overdue = recorder.calls.find(
    (call) => call.operation === "leadTask.findMany",
  );
  const where = (overdue?.args as { where: { lead: unknown } }).where;
  assert.deepEqual(where.lead, LIVE_LEAD);
});

test("meetings on closed or archived leads stay out of the week ahead", async () => {
  const recorder = digestDb();
  await loadOfficeDigest(recorder.db, new Date("2026-11-13T02:00:00Z"));

  const meetings = recorder.calls.find(
    (call) => call.operation === "lead.findMany",
  );
  const where = (meetings?.args as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.stage, LIVE_LEAD.stage);
  assert.equal(where.isArchived, false);
});

// #432: "anything overdue?" answered from the digest said 11 and led with a
// real lead; the same question answered live listed a Lost lead's wait. The
// office-wide live lookup and the digest share overdueLeadTaskWhere, so they
// cannot disagree about what counts.
test("the digest and the office-wide live lookup read overdue work by one rule", async () => {
  const now = new Date("2026-11-13T02:00:00Z");

  const digest = digestDb();
  await loadOfficeDigest(digest.db, now);
  const digestWhere = (
    digest.calls.find((call) => call.operation === "leadTask.findMany")
      ?.args as { where: unknown }
  ).where;

  const live = recordingDb({
    "leadTask.count": 0,
    "leadTask.findMany": [],
  });
  await listOverdueLeadTasks(
    systemPrincipal("test"),
    { limit: 25 },
    live.db,
    now,
  );
  for (const call of live.calls) {
    const where = (call.args as { where: unknown }).where;
    assert.deepEqual(where, digestWhere, `${call.operation} uses the rule`);
  }
  assert.deepEqual(digestWhere, overdueLeadTaskWhere(now));
  assert.deepEqual((digestWhere as { lead: unknown }).lead, LIVE_LEAD);
  assert.deepEqual(live.calls.map((call) => call.operation).sort(), [
    "leadTask.count",
    "leadTask.findMany",
  ]);
});

test("the live overdue lookup reports the full count and drops undated rows", async () => {
  const live = recordingDb({
    "leadTask.count": 30,
    "leadTask.findMany": [
      {
        dueDate: new Date("2026-09-18T14:00:00Z"),
        dueTime: null,
        id: 1,
        lead: { id: 7, name: "Riva Test", stage: "QUALIFIED" },
        notes: null,
        type: "CALL",
      },
    ],
  });
  const result = await listOverdueLeadTasks(
    systemPrincipal("test"),
    { limit: 1 },
    live.db,
    new Date("2026-11-13T02:00:00Z"),
  );
  assert.equal(result.total, 30, "a capped list still says how many there are");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0]!.leadName, "Riva Test");
});
