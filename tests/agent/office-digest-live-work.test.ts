import assert from "node:assert/strict";
import { test } from "vitest";

import { loadOfficeDigest } from "@/lib/domain/agent-context/sources";
import { LIVE_LEAD } from "@/lib/leads/followup-due";
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
