import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAD_TASK_DUE_PRESETS,
  LEAD_TASK_TYPES,
  dueDateFromPreset,
  taskTypeFromNote,
} from "../../lib/leads/task-presets";
import { createLeadTaskSchema } from "../../utils/validators/lead-task";
import { stageMap } from "../../types/lead";
import { STAGE_STYLES } from "../../lib/leads/lead-helpers";

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

const SYDNEY = "Australia/Sydney";
const sydneyOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});

test("a preset lands on Sydney midnight, whatever zone the machine is in", () => {
  // Asserted in Sydney, not in the runner's local zone. CI runs UTC and a
  // developer's laptop does not, so getHours() would give two different
  // answers for the same correct instant.
  const due = dueDateFromPreset(1, new Date("2026-08-21T06:30:00.000Z"));
  const p = sydneyOf(due);
  assert.equal(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, "2026-08-22 00:00");
});

test("a preset advances by whole days across a month boundary", () => {
  const due = dueDateFromPreset(7, new Date("2026-08-28T09:00:00.000Z"));
  const p = sydneyOf(due);
  assert.equal(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, "2026-09-04 00:00");
});

test("every type has a label and a verb", () => {
  assert.equal(LEAD_TASK_TYPES.length, 4);
  for (const t of LEAD_TASK_TYPES) {
    assert.ok(t.label.length > 0, t.value);
    assert.ok(t.verb.length > 0, t.value);
  }
});

test("the due time schema rejects what max(10) used to accept", () => {
  // The field ends up rendered verbatim on a row, so "banana" and "99:99"
  // reaching the database is a display bug waiting to happen.
  const ok = ["00:00", "09:30", "23:59"];
  const bad = ["banana", "99:99", "9:30", "24:00", "12:60", ""];
  for (const t of ok) {
    assert.equal(createLeadTaskSchema.shape.dueTime.safeParse(t).success, true, t);
  }
  for (const t of bad) {
    assert.equal(createLeadTaskSchema.shape.dueTime.safeParse(t).success, false, t);
  }
  assert.equal(createLeadTaskSchema.shape.dueTime.safeParse(null).success, true);
});

test("a new task must have a due date", () => {
  assert.equal(createLeadTaskSchema.shape.dueDate.safeParse(null).success, false);
  assert.equal(
    createLeadTaskSchema.shape.dueDate.safeParse("2026-08-26T00:00:00.000Z").success,
    true,
  );

  // The whole payload too, not only the field. A client that leaves dueDate
  // out entirely is the case the route actually sees, and the field-level
  // assertion above says nothing about whether the object requires it.
  const task = { leadId: 1, type: "CALL" as const, dueTime: null, notes: null };
  assert.equal(createLeadTaskSchema.safeParse(task).success, false);
  assert.equal(
    createLeadTaskSchema.safeParse({ ...task, dueDate: "2026-08-26T00:00:00.000Z" })
      .success,
    true,
  );
});

test("a task row must carry the UI stage label, not the Prisma enum", () => {
  // The E2E crash. LeadTaskRow.lead.stage was typed as string and passed the
  // Prisma value through. Three callers assign it straight onto a Lead, so
  // "DISCOVERY" reached stageDef(), which threw, and the lead page rendered
  // "This lead could not be loaded" the moment anyone added a task.
  for (const [prisma, label] of Object.entries(stageMap)) {
    assert.equal(typeof label, "string", prisma);
    // Every mapped label must be one the UI can actually resolve.
    assert.ok(STAGE_STYLES[label], `${prisma} -> ${label} has no badge style`);
  }
  assert.equal(stageMap.DISCOVERY, "Discovery");
  assert.notEqual(stageMap.DISCOVERY, "DISCOVERY");
});
