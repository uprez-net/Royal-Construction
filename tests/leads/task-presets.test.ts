import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAD_TASK_DUE_PRESETS,
  LEAD_TASK_TYPES,
  dueDateFromPreset,
  taskTypeFromNote,
} from "../../lib/leads/task-presets";

test("every note recorded on production classifies", () => {
  // The real strings, verbatim from the production followupNotes column.
  const REAL: [string, string][] = [
    ["Organise a Meeting", "MEETING"],
    ["Call and organise meeting", "MEETING"],
    ["Send an Email/Text", "EMAIL"],
    ["Waiting for information", "WAITING"],
    ["Called multiple occasions", "CALL"],
    ["Need to call back", "CALL"],
    ["Follow-up in 7 days", "CALL"],
    ["Follow-up in 1 Day", "CALL"],
    ["Follow-up in 1 day", "CALL"],
    ["Follow-up in 3 months", "CALL"],
    ["Follow-up in 6 months", "CALL"],
  ];
  for (const [note, expected] of REAL) {
    assert.equal(taskTypeFromNote(note), expected, note);
  }
});

test("a meeting note beats an email note", () => {
  // "Call and organise meeting" mentions calling first. The specific intent has
  // to win or half the meeting requests classify as calls.
  assert.equal(taskTypeFromNote("Call and organise meeting"), "MEETING");
  assert.equal(taskTypeFromNote("Email them about the meeting"), "MEETING");
});

test("no note at all is a call", () => {
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(taskTypeFromNote(empty), "CALL", String(empty));
  }
});

test("the presets cover the intervals people actually typed", () => {
  // 1 day, 7 days, 1 month, 3 months and 6 months all appear in production
  // notes. If a preset is dropped, someone goes back to typing prose.
  assert.deepEqual(
    LEAD_TASK_DUE_PRESETS.map((p) => p.days),
    [1, 7, 30, 90, 180],
  );
});

test("a preset lands on midnight, not on the moment it was created", () => {
  // A task made at 4pm must not read as overdue the next morning just because
  // the bucket boundary is midnight.
  const from = new Date("2026-08-21T16:30:00.000Z");
  const due = dueDateFromPreset(1, from);
  assert.equal(due.getHours(), 0);
  assert.equal(due.getMinutes(), 0);
  assert.equal(due.getSeconds(), 0);
});

test("a preset advances by whole days across a month boundary", () => {
  const due = dueDateFromPreset(7, new Date("2026-08-28T09:00:00.000Z"));
  assert.equal(due.getMonth(), 8); // September
  assert.equal(due.getDate(), 4);
});

test("every type has a label and a verb", () => {
  assert.equal(LEAD_TASK_TYPES.length, 4);
  for (const t of LEAD_TASK_TYPES) {
    assert.ok(t.label.length > 0, t.value);
    assert.ok(t.verb.length > 0, t.value);
  }
});
