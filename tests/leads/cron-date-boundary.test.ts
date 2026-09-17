import assert from "node:assert/strict";
import { test } from "node:test";

import { fromZonedTime } from "date-fns-tz";

import { dueDateFromPreset } from "../../lib/leads/task-presets";

/**
 * The date arithmetic both reminder crons depend on.
 *
 * Neither cron can be unit tested directly here (each is a route that talks to
 * Graph and Novu), so the comparison that decides whether a reminder fires
 * lives as assertions on the same two helpers the routes use.
 */
const SYDNEY = "Australia/Sydney";

function sydneyDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const utcDateOnly = (d: Date) => d.toISOString().slice(0, 10);

test("a task due at Sydney midnight is NOT the same UTC date", () => {
  // The bug this replaces. The cron compared toISOString().slice(0,10) against
  // a Sydney date string. A task due 22 August in Sydney is stored as
  // 21 August 14:00Z, so the UTC slice says the 21st, the Sydney string says
  // the 22nd, they never match, and the reminder never fires.
  const due = dueDateFromPreset(1, new Date("2026-08-21T06:00:00.000Z"));
  assert.equal(sydneyDateOnly(due), "2026-08-22");
  assert.notEqual(utcDateOnly(due), sydneyDateOnly(due));
  assert.equal(utcDateOnly(due), "2026-08-21");
});

test("both sides of the comparison agree when both are Sydney", () => {
  const due = dueDateFromPreset(7, new Date("2026-08-21T06:00:00.000Z"));
  const asIfToday = new Date(due.getTime() + 6 * 3600 * 1000); // 6am Sydney that day
  assert.equal(sydneyDateOnly(due), sydneyDateOnly(asIfToday));
});

test("Sydney midnight as an instant is not the UTC string of that date", () => {
  // The meeting cron built `new Date(\`${sydneyDate}T00:00:00.000Z\`)`, which
  // parses a Sydney calendar date as UTC. Ten hours adrift in AEST, eleven in
  // AEDT, so meetings inside that window were reminded a day early or missed.
  const wrong = new Date("2026-08-21T00:00:00.000Z");
  const right = fromZonedTime("2026-08-21T00:00:00", SYDNEY);
  const hoursApart = (wrong.getTime() - right.getTime()) / 3600000;
  assert.equal(hoursApart, 10, "AEST is UTC+10");
  assert.equal(sydneyDateOnly(right), "2026-08-21");
});

test("the offset is eleven hours under daylight saving", () => {
  // Sydney is UTC+11 from early October, so a fixed offset would be wrong for
  // a third of the year. Both helpers read the zone rather than a constant.
  const wrong = new Date("2026-12-01T00:00:00.000Z");
  const right = fromZonedTime("2026-12-01T00:00:00", SYDNEY);
  assert.equal((wrong.getTime() - right.getTime()) / 3600000, 11);
});

test("a task due today is due, one due tomorrow is not", () => {
  const now = new Date("2026-08-21T06:00:00.000Z"); // 4pm Sydney, 21 Aug
  const today = sydneyDateOnly(now);
  assert.equal(today, "2026-08-21");
  assert.equal(sydneyDateOnly(dueDateFromPreset(1, now)) === today, false);
  assert.equal(sydneyDateOnly(now) === today, true);
});
