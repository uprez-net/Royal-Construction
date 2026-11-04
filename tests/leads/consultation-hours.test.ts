import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import {
  assertConsultationSlot,
  consultationDurationLabel,
  consultationStartTimes,
} from "@/lib/domain/leads/consultation-hours";
import { REPO_ROOT } from "../support/repo-root";

// A consultation can now run longer than an hour. The booking route is on the
// open internet, so it checks the same hours and lengths the page offers
// rather than trusting whatever it is posted.

const WEDNESDAY = 3;
const SATURDAY = 6;

test("a longer meeting has fewer starts, all finishing by closing", () => {
  assert.deepEqual(consultationStartTimes(WEDNESDAY, 60), [
    "14:00",
    "15:00",
    "16:00",
    "17:00",
  ]);
  assert.deepEqual(consultationStartTimes(WEDNESDAY, 120), [
    "14:00",
    "15:00",
    "16:00",
  ]);
  assert.deepEqual(consultationStartTimes(WEDNESDAY, 90), [
    "14:00",
    "15:00",
    "16:00",
  ]);
  assert.deepEqual(consultationStartTimes(SATURDAY, 180), [
    "09:00",
    "10:00",
    "11:00",
  ]);
});

test("the lengths read as people say them", () => {
  assert.equal(consultationDurationLabel(60), "1 hour");
  assert.equal(consultationDurationLabel(90), "1.5 hours");
  assert.equal(consultationDurationLabel(120), "2 hours");
});

test("the route takes what the page offers", () => {
  // 2026-10-14 is a Wednesday; 2026-10-17 a Saturday.
  assertConsultationSlot("2026-10-14T16:00:00", 120);
  assertConsultationSlot("2026-10-14T14:00", 180);
  assertConsultationSlot("2026-10-17T09:00:00", 60);
});

test("the route refuses what the page would never offer", () => {
  for (const [start, minutes] of [
    // Runs past six on a weekday.
    ["2026-10-14T17:00:00", 120],
    // Outside weekday hours altogether.
    ["2026-10-14T09:00:00", 60],
    // Not on the hour.
    ["2026-10-14T14:30:00", 60],
    // A length nobody can pick.
    ["2026-10-14T14:00:00", 540],
    ["2026-10-14T14:00:00", 0],
    // Not a date.
    ["2026-02-30T14:00:00", 60],
    ["tomorrow at two", 60],
  ] as const) {
    assert.throws(
      () => assertConsultationSlot(start, minutes),
      DomainValidationError,
      `${start} for ${minutes} minutes`,
    );
  }
});

test("the route checks the slot before the calendar and books the chosen length", () => {
  const route = readFileSync(
    join(REPO_ROOT, "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  const check = route.indexOf("assertConsultationSlot(");
  assert.ok(check > 0, "the route never checks the requested slot");
  assert.ok(
    check < route.indexOf("await findConflictingEvent("),
    "the slot must be refused before the calendar is read",
  );
  assert.match(
    route,
    /const slotEnd = new Date\(slotStart\.getTime\(\) \+ durationMs\)/,
  );
  assert.match(route, /new Date\(start\.getTime\(\) \+ durationMs\)/);
  // The old fixed hour. The day of padding on the calendar read stays.
  assert.doesNotMatch(route, /\+ 60 \* 60 \* 1000/);
});
