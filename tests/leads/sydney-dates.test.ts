import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sydneyDateOnly,
  sydneyEndOfDay,
  sydneyMidnightIn,
  sydneyStartOfDay,
  sydneyTimeOnly,
} from "../../lib/dates/sydney";

test("a UTC date slice and a Sydney date are different calendars", () => {
  // The defect that stopped reminders firing. Anything from 14:00Z onwards is
  // already tomorrow in Sydney.
  const evening = new Date("2026-08-21T14:30:00.000Z");
  assert.equal(evening.toISOString().slice(0, 10), "2026-08-21");
  assert.equal(sydneyDateOnly(evening), "2026-08-22");
});

test("the wall clock is Sydney's, not the server's", () => {
  // toTimeString() on a UTC box turned a 1pm Sydney appointment into "03:00".
  const onePmSydney = new Date("2026-08-21T03:00:00.000Z");
  assert.equal(sydneyTimeOnly(onePmSydney), "13:00");
});

test("a Sydney day does not start at UTC midnight", () => {
  const start = sydneyStartOfDay("2026-08-21");
  assert.equal(start.toISOString(), "2026-08-20T14:00:00.000Z");
  assert.notEqual(start.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.equal(sydneyDateOnly(start), "2026-08-21");
});

test("the offset follows daylight saving", () => {
  // AEST is +10, AEDT is +11. A hardcoded offset is wrong for a third of the
  // year, which is why these go through the zone rather than arithmetic.
  assert.equal(sydneyStartOfDay("2026-08-21").toISOString(), "2026-08-20T14:00:00.000Z");
  assert.equal(sydneyStartOfDay("2026-12-01").toISOString(), "2026-11-30T13:00:00.000Z");
});

test("a Sydney day ends just before the next one begins", () => {
  const end = sydneyEndOfDay("2026-08-21");
  const nextStart = sydneyStartOfDay("2026-08-22");
  assert.ok(end < nextStart);
  assert.ok(nextStart.getTime() - end.getTime() <= 1000);
  assert.equal(sydneyDateOnly(end), "2026-08-21");
});

test("a preset lands on Sydney midnight whatever zone the caller is in", () => {
  const due = sydneyMidnightIn(1, new Date("2026-08-21T06:30:00.000Z"));
  assert.equal(sydneyDateOnly(due), "2026-08-22");
  assert.equal(sydneyTimeOnly(due), "00:00");
});

test("presets cross a month boundary by whole days", () => {
  const due = sydneyMidnightIn(7, new Date("2026-08-28T09:00:00.000Z"));
  assert.equal(sydneyDateOnly(due), "2026-09-04");
});

test("a task due today reads as today all day long", () => {
  // The comparison both crons and the panel make. It has to hold at 1am and at
  // 11pm Sydney, which is 15:00Z the previous day and 13:00Z the same day.
  const due = sydneyMidnightIn(0, new Date("2026-08-21T06:00:00.000Z"));
  for (const at of ["2026-08-20T15:00:00.000Z", "2026-08-21T02:00:00.000Z", "2026-08-21T12:59:00.000Z"]) {
    assert.equal(sydneyDateOnly(due), sydneyDateOnly(new Date(at)), at);
  }
});
