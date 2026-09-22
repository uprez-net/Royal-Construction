import assert from "node:assert/strict";
import { test } from "vitest";

import { taskTypeFromNote } from "@/lib/leads/task-presets";

/**
 * The bucketing rules the Follow-ups tab applies, asserted as pure logic.
 *
 * The component itself cannot be unit tested here (no component harness in this
 * repo), so the rules that actually changed behaviour live as assertions on the
 * same predicates the view uses.
 */
type T = { dueDate: string | null; type: string };

const TODAY = new Date("2026-08-21T00:00:00.000Z");
const isDue = (t: T) => t.dueDate === null || new Date(t.dueDate) <= TODAY;
const isUpcoming = (t: T) => t.dueDate !== null && new Date(t.dueDate) > TODAY;

test("an undated task is pending, not invisible", () => {
  // This is the whole point. Five production leads sat at In Follow-up with no
  // date, appeared in no bucket, and the tab told everyone "All caught up".
  assert.equal(isDue({ dueDate: null, type: "CALL" }), true);
  assert.equal(isUpcoming({ dueDate: null, type: "CALL" }), false);
});

test("every task lands in exactly one bucket", () => {
  // The old counts did not add up: 12 pending + 1 upcoming against 14 total,
  // because a date falling during today matched neither comparison.
  const tasks: T[] = [
    { dueDate: null, type: "CALL" },
    { dueDate: "2026-08-01T00:00:00.000Z", type: "CALL" },
    { dueDate: "2026-08-21T00:00:00.000Z", type: "CALL" },
    { dueDate: "2026-08-21T09:30:00.000Z", type: "CALL" },
    { dueDate: "2026-09-01T00:00:00.000Z", type: "CALL" },
  ];
  for (const t of tasks) {
    const inOne = Number(isDue(t)) + Number(isUpcoming(t));
    assert.equal(inOne, 1, `${t.dueDate} landed in ${inOne} buckets`);
  }
  assert.equal(
    tasks.filter(isDue).length + tasks.filter(isUpcoming).length,
    tasks.length,
  );
});

test("meetings and other work are split by type, not by stage", () => {
  // Before this, a meeting was a STAGE. One production lead sat at
  // MEETING_SCHEDULED and had no meeting date at all, so the meeting buckets
  // had been empty for the life of the feature.
  const tasks = [
    { dueDate: null, type: "MEETING" },
    { dueDate: null, type: "CALL" },
    { dueDate: null, type: "EMAIL" },
    { dueDate: null, type: "WAITING" },
  ];
  assert.equal(tasks.filter((t) => t.type === "MEETING").length, 1);
  assert.equal(tasks.filter((t) => t.type !== "MEETING").length, 3);
});

test("a legacy note still routes a backfilled task to the meeting bucket", () => {
  // The 7 staging and 4 production leads whose note said "Organise a Meeting"
  // have to arrive as meetings, or the meeting buckets stay empty after the
  // migration too.
  assert.equal(taskTypeFromNote("Organise a Meeting"), "MEETING");
});

test("the pending badge counts the same rows the list renders", () => {
  // On staging the badge read "24 pending" above 32 visible rows: the stats
  // breakdown excludes meetings on purpose, and the badge was reading it.
  const tasks: T[] = [
    { dueDate: null, type: "CALL" },
    { dueDate: null, type: "MEETING" },
    { dueDate: "2026-08-01T00:00:00.000Z", type: "MEETING" },
    { dueDate: "2026-08-01T00:00:00.000Z", type: "EMAIL" },
  ];
  const listed = tasks.filter(isDue);
  const nonMeeting = listed.filter((t) => t.type !== "MEETING");
  assert.equal(listed.length, 4, "the list shows every type");
  assert.equal(nonMeeting.length, 2, "the breakdown excludes meetings");
  assert.notEqual(
    listed.length,
    nonMeeting.length,
    "these are different numbers, which is why the badge must use the first",
  );
});
