import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { sydneyDayRange } from "@/lib/dates/day-range";
import { DomainValidationError } from "@/lib/domain/errors";
import {
  listLeadMeetings,
  listLeadTasksDue,
  listOverdueLeadTasks,
} from "@/lib/domain/leads/queries";
import { listMilestonesDue } from "@/lib/domain/projects/milestones-due";
import { listOfficeOffers } from "@/lib/domain/offers/office-list";
import { LIVE_LEAD } from "@/lib/leads/followup-due";
import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// #618: the briefs came back "incomplete" because no read answered an
// office-wide date question; specialists walked records one at a time.

// Tue 24 Nov 2026, 9 am AEDT.
const NOW = new Date("2026-11-23T22:00:00Z");

describe("sydneyDayRange", () => {
  it("names today, tomorrow, the rest of this week and the next seven days", () => {
    assert.deepEqual(
      [
        sydneyDayRange({ range: "today" }, NOW),
        sydneyDayRange({ range: "tomorrow" }, NOW),
        sydneyDayRange({ range: "this_week" }, NOW),
        sydneyDayRange({ range: "next_7_days" }, NOW),
      ].map((range) => [range.fromDay, range.toDay]),
      [
        ["2026-11-24", "2026-11-24"],
        ["2026-11-25", "2026-11-25"],
        ["2026-11-24", "2026-11-29"],
        ["2026-11-24", "2026-11-30"],
      ],
    );
  });

  it("covers whole Sydney days", () => {
    const today = sydneyDayRange({}, NOW);
    assert.equal(today.from.toISOString(), "2026-11-23T13:00:00.000Z");
    assert.equal(today.to.toISOString(), "2026-11-24T12:59:59.999Z");
  });

  it("lets explicit dates win and refuses a window that runs backwards", () => {
    const explicit = sydneyDayRange(
      { from: "2026-12-01", range: "today", to: "2026-12-03" },
      NOW,
    );
    assert.deepEqual(
      [explicit.fromDay, explicit.toDay],
      ["2026-12-01", "2026-12-03"],
    );
    assert.throws(
      () => sydneyDayRange({ from: "2026-12-03", to: "2026-12-01" }, NOW),
      RangeError,
    );
    assert.throws(
      () => sydneyDayRange({ from: "2026-01-01", to: "2026-12-31" }, NOW),
      RangeError,
    );
  });
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    assignedTo: null,
    dueDate: new Date("2026-11-24T00:00:00Z"),
    dueTime: "10:00",
    id: 7,
    lead: {
      assignedUser: { name: "Owner One" },
      id: 105,
      name: "Client A",
      stage: "QUALIFIED",
    },
    notes: null,
    type: "CALL",
    ...overrides,
  };
}

describe("lead tasks due and meetings", () => {
  it("reads open tasks on live leads in the window, with the lead's owner when the task has none", async () => {
    const recorder = recordingDb({
      "leadTask.count": 1,
      "leadTask.findMany": [taskRow()],
    });
    const result = await listLeadTasksDue(
      adminPrincipal(),
      { limit: 30, range: "today" },
      recorder.db,
      NOW,
    );
    assert.equal(result.tasks[0]?.ownerName, "Owner One");
    assert.deepEqual(
      [result.range.fromDay, result.range.toDay],
      ["2026-11-24", "2026-11-24"],
    );
    const where = (
      recorder.calls.find((call) => call.operation === "leadTask.findMany")
        ?.args as { where: Record<string, unknown> }
    ).where;
    assert.deepEqual(where.lead, LIVE_LEAD);
    assert.equal(where.completedAt, null);
    assert.deepEqual(where.dueDate, {
      gte: new Date("2026-11-23T13:00:00.000Z"),
      lte: new Date("2026-11-24T12:59:59.999Z"),
    });
  });

  it("prefers the task's own assignee", async () => {
    const recorder = recordingDb({
      "leadTask.count": 1,
      "leadTask.findMany": [taskRow({ assignedTo: { name: "Owner Two" } })],
    });
    const result = await listLeadTasksDue(
      adminPrincipal(),
      { limit: 30 },
      recorder.db,
      NOW,
    );
    assert.equal(result.tasks[0]?.ownerName, "Owner Two");
  });

  it("reads meetings as MEETING tasks", async () => {
    const recorder = recordingDb({
      "leadTask.count": 0,
      "leadTask.findMany": [],
    });
    await listLeadMeetings(
      adminPrincipal(),
      { limit: 30, range: "tomorrow" },
      recorder.db,
      NOW,
    );
    const where = (
      recorder.calls.find((call) => call.operation === "leadTask.findMany")
        ?.args as { where: Record<string, unknown> }
    ).where;
    assert.deepEqual(where.type, { in: ["MEETING"] });
  });

  it("gives the overdue list owners too", async () => {
    const recorder = recordingDb({
      "leadTask.count": 1,
      "leadTask.findMany": [taskRow()],
    });
    const result = await listOverdueLeadTasks(
      adminPrincipal(),
      { limit: 25 },
      recorder.db,
      NOW,
    );
    assert.equal(result.tasks[0]?.ownerName, "Owner One");
  });

  it("turns a bad window into a refusal the operator can read", async () => {
    await assert.rejects(
      listLeadTasksDue(
        adminPrincipal(),
        { from: "2026-12-03", limit: 30, to: "2026-12-01" },
        recordingDb().db,
        NOW,
      ),
      DomainValidationError,
    );
  });
});

describe("milestones due across jobs in progress", () => {
  it("reads open milestones in the window and those behind, on jobs in progress", async () => {
    const recorder = recordingDb({
      "milestone.count": 0,
      "milestone.findMany": [],
    });
    await listMilestonesDue(
      adminPrincipal(),
      { includeOverdue: true, limit: 40, range: "this_week" },
      recorder.db,
      NOW,
    );
    const reads = recorder.calls.filter(
      (call) => call.operation === "milestone.findMany",
    );
    assert.equal(reads.length, 2);
    const [due, overdue] = reads.map(
      (call) => (call.args as { where: Record<string, unknown> }).where,
    );
    assert.deepEqual(due?.project, {
      status: { notIn: ["COMPLETED", "DRAFT"] },
    });
    assert.deepEqual(due?.status, { in: ["PENDING", "ACTIVE"] });
    assert.deepEqual(overdue?.targetDate, {
      lt: new Date("2026-11-23T13:00:00.000Z"),
    });
    // Behind means under way and late, on a job being built: a job waiting on
    // its certifier has nothing overdue however old its planned dates.
    assert.equal(overdue?.status, "ACTIVE");
    assert.deepEqual(overdue?.project, {
      status: { in: ["ACTIVE", "ON_TRACK", "NEEDS_ATTENTION", "DELAYED"] },
    });
  });

  it("does not read what is behind when not asked", async () => {
    const recorder = recordingDb({
      "milestone.count": 0,
      "milestone.findMany": [],
    });
    const result = await listMilestonesDue(
      adminPrincipal(),
      { includeOverdue: false, limit: 40 },
      recorder.db,
      NOW,
    );
    assert.equal(
      recorder.calls.filter((call) => call.operation === "milestone.findMany")
        .length,
      1,
    );
    assert.equal(result.overdue.total, 0);
  });
});

describe("offers across the office", () => {
  const offerRow = {
    baseReference: "RC-2026-014",
    contractValueIncGst: 612345.5,
    id: "offer_1",
    lead: { location: "12 Example St, Oran Park", name: "Client A" },
    leadId: 105,
    offerStatus: "OFFER_SENT",
    revisionNumber: 2,
    sentAt: new Date("2026-11-20T00:00:00Z"),
    updatedAt: new Date("2026-11-23T00:00:00Z"),
    workspaceState: null,
  };

  function offersDb() {
    return recordingDb({
      "offer.count": 1,
      "offer.findMany": (args: unknown) => {
        // The follow-up rule reads offers with its own select.
        const select = (args as { select: Record<string, unknown> }).select;
        return "revisionNumber" in select
          && "baseReference" in select
          && !("emailMessages" in select)
          && "workspaceState" in select
          ? [offerRow]
          : [];
      },
    });
  }

  it("lists by group, and gives an office caller the value", async () => {
    const recorder = offersDb();
    const result = await listOfficeOffers(
      adminPrincipal(),
      { group: "awaiting_signature", limit: 25 },
      recorder.db,
      NOW,
    );
    // The list itself, not the follow-up read that assesses its rows.
    const list = recorder.calls.find(
      (call) =>
        call.operation === "offer.findMany"
        && "baseReference" in ((call.args as { select?: object }).select ?? {}),
    );
    const where = (list?.args as { where: Record<string, unknown> }).where;
    assert.deepEqual(where.offerStatus, {
      in: ["OFFER_SENT", "TENDER_SENT", "CONTRACT_SENT"],
    });
    assert.equal(where.isActive, true);
    assert.equal(result.offers[0]?.reference, "RC-2026-014-R2");
    assert.equal(result.offers[0]?.valueIncGst, 612345.5);
  });

  it("keeps the price from a caller who is not office staff", async () => {
    const recorder = offersDb();
    const result = await listOfficeOffers(
      siteManagerPrincipal(),
      { limit: 25 },
      recorder.db,
      NOW,
    );
    for (const offer of result.offers) assert.equal(offer.valueIncGst, null);
  });
});
