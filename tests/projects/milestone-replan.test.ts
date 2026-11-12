import assert from "node:assert/strict";

import { test } from "vitest";

import { MilestoneStatus } from "@prisma/client";

import {
  DEFAULT_ACTIVITY_DURATION_DAYS,
  milestoneEndDate,
  replanFollowingActivities,
  type SequencedActivity,
} from "@/lib/domain/projects/milestone-schedule";
import {
  replanAfterActivity,
  updateMilestone,
} from "@/lib/domain/projects/milestones";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Issue #422: closing an activity plans the next one from the day it closed.

const { PENDING, ACTIVE, DONE, NOT_REQUIRED } = MilestoneStatus;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const row = (
  id: string,
  status: MilestoneStatus,
  patch: Partial<SequencedActivity> = {},
): SequencedActivity => ({
  estimatedDays: 2,
  id,
  status,
  targetDate: day("2026-11-01"),
  ...patch,
});

test("the default duration is two calendar days", () => {
  assert.equal(DEFAULT_ACTIVITY_DURATION_DAYS, 2);
  assert.equal(
    iso(milestoneEndDate({ targetDate: day("2026-11-12") })),
    "2026-11-14",
  );
});

test("the issue's example: A closes 12 Nov, B (2 days) is due 14 Nov", () => {
  const ordered = [
    row("A", DONE, { actualDate: day("2026-11-12") }),
    row("B", PENDING, { estimatedDays: 2 }),
    row("C", PENDING, { estimatedDays: 4 }),
  ];
  const changes = replanFollowingActivities(ordered, 0, day("2026-11-12"));
  assert.deepEqual(
    changes.map((change) => [change.id, iso(change.targetDate)]),
    [
      ["B", "2026-11-12"],
      ["C", "2026-11-14"],
    ],
  );
  assert.equal(
    iso(milestoneEndDate({ ...ordered[1], targetDate: changes[0].targetDate })),
    "2026-11-14",
  );
});

test("an activity under way keeps its plan and anchors what follows from its own end", () => {
  const ordered = [
    row("A", DONE),
    row("B", ACTIVE, { estimatedDays: 5, startDate: day("2026-11-10") }),
    row("C", PENDING),
  ];
  const changes = replanFollowingActivities(ordered, 0, day("2026-11-12"));
  assert.deepEqual(
    changes.map((change) => [change.id, iso(change.targetDate)]),
    [["C", "2026-11-15"]],
  );
});

test("a completed activity is never re-dated, and one finished out of sequence anchors the rest", () => {
  const ordered = [
    row("A", DONE),
    row("B", DONE, { actualDate: day("2026-11-20") }),
    row("C", NOT_REQUIRED),
    row("D", PENDING),
  ];
  const changes = replanFollowingActivities(ordered, 0, day("2026-11-12"));
  assert.deepEqual(
    changes.map((change) => [change.id, iso(change.targetDate)]),
    [["D", "2026-11-20"]],
  );
});

test("re-planning an already planned sequence changes nothing", () => {
  const ordered = [
    row("A", DONE),
    row("B", PENDING, { targetDate: day("2026-11-12") }),
    row("C", PENDING, { targetDate: day("2026-11-14") }),
  ];
  assert.deepEqual(
    replanFollowingActivities(ordered, 0, day("2026-11-12")),
    [],
  );
});

test("the write only lands on an activity still pending", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [
      { ...row("A", DONE), actualDate: day("2026-11-12"), startDate: null },
      { ...row("B", PENDING), actualDate: null, startDate: null },
    ],
  });
  const changes = await replanAfterActivity(
    { from: day("2026-11-12"), milestoneId: "A", projectId: "p_1" },
    recorder.db,
  );
  assert.equal(changes.length, 1);
  assert.deepEqual(
    recorder.writes().map((write) => write.args),
    [
      {
        data: { targetDate: day("2026-11-12") },
        where: { id: "B", status: PENDING },
      },
    ],
  );
});

/** A completed activity, edited again, with the sequence that follows it. */
function doneDb(storedActualDate: Date) {
  return recordingDb({
    "invoice.findUnique": null,
    "milestone.aggregate": { _sum: { spend: "500" } },
    "milestone.count": 1,
    "milestone.findMany": (args: unknown) =>
      (args as { orderBy?: unknown }).orderBy
        ? [
            {
              actualDate: storedActualDate,
              estimatedDays: 2,
              id: "A",
              startDate: day("2026-11-10"),
              status: DONE,
              targetDate: day("2026-11-10"),
            },
            {
              actualDate: null,
              estimatedDays: 2,
              id: "B",
              startDate: null,
              status: PENDING,
              targetDate: day("2026-11-12"),
            },
          ]
        : [],
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      actualDate: storedActualDate,
      id: "A",
      name: "Slab pour",
      parentId: null,
      projectId: "p_1",
      status: DONE,
    },
    "milestone.update": {
      budget: { toString: () => "500" },
      id: "A",
      name: "Slab pour",
      parentId: null,
      projectId: "p_1",
      spend: { toString: () => "500" },
      status: DONE,
    },
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "House",
      siteManagerId: null,
    },
    "project.update": { siteManagerId: null, spent: "500" },
    "tradieSchedule.findMany": [],
  });
}

const replanWrites = (recorder: ReturnType<typeof recordingDb>) =>
  recorder
    .writes()
    .filter(
      (write) =>
        write.operation === "milestone.updateMany"
        && "targetDate" in (write.args as { data: object }).data,
    )
    .map((write) => write.args);

test("correcting a completed activity's completion date re-plans what follows", async () => {
  const recorder = doneDb(day("2026-11-12"));
  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      actualDate: "2026-11-15",
      milestoneId: "A",
      spend: 500,
      startDate: "2026-11-10",
      status: DONE,
    },
    recorder.db,
  );
  assert.deepEqual(
    outcome.replannedActivities.map((c) => [c.id, iso(c.targetDate)]),
    [["B", "2026-11-15"]],
  );
  assert.equal(replanWrites(recorder).length, 1);
  assert.deepEqual(replanWrites(recorder), [
    {
      data: { targetDate: day("2026-11-15") },
      where: { id: "B", status: PENDING },
    },
  ]);
});

test("editing only a completed activity's spend moves nothing", async () => {
  const recorder = doneDb(day("2026-11-12"));
  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      actualDate: day("2026-11-12").toISOString(),
      milestoneId: "A",
      spend: 650,
      startDate: "2026-11-10",
      status: DONE,
    },
    recorder.db,
  );
  assert.deepEqual(outcome.replannedActivities, []);
  assert.deepEqual(replanWrites(recorder), []);
});
