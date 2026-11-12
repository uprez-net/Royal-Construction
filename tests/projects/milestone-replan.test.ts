import assert from "node:assert/strict";

import { test } from "vitest";

import { MilestoneStatus } from "@prisma/client";

import {
  DEFAULT_ACTIVITY_DURATION_DAYS,
  milestoneEndDate,
  replanFollowingActivities,
  type SequencedActivity,
} from "@/lib/domain/projects/milestone-schedule";
import { replanAfterActivity } from "@/lib/domain/projects/milestones";

import { recordingDb } from "../architecture/domain-harness";

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
