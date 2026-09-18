import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CLOSED_LEAD_STAGES,
  LIVE_LEAD,
  dueFollowUpTaskWhere,
} from "../../lib/leads/followup-due";

// The dashboard was the last screen still answering "what follow-ups are
// outstanding?" from `Lead.followupDate` / `Lead.followupCompletedAt`. Two
// separate faults met there:
//
//   * the KPI counted with `"assignedId" = <clerk id>` in raw SQL, comparing a
//     `User.id` uuid column against the identifier `auth()` returns. It read 0
//     for everyone, always, without erroring.
//   * the card beneath it listed fifteen leads that no action could clear,
//     because the only writer of `followupCompletedAt` is gated behind an
//     input no UI component sends.
//
// So the header said 0 and the card said 15, about the same question.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * The file with its comments removed.
 *
 * The assertions below are about what the module *queries*, and the docblocks
 * deliberately name the columns it no longer reads, to explain why. Matching
 * raw source would fail on the explanation rather than the code.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// A Tuesday. Sydney is on AEST in September, UTC+10, so the Sydney day runs
// from 14:00 the previous day UTC to 13:59:59.999 UTC.
const MIDDAY_SYDNEY = new Date("2026-09-15T02:00:00.000Z");

const dueDateFilter = (now: Date) => {
  const { dueDate } = dueFollowUpTaskWhere(now);
  assert.ok(
    dueDate && typeof dueDate === "object" && "lte" in dueDate,
    "the predicate no longer bounds dueDate",
  );
  return dueDate as { lte: Date; not: null };
};

// ── The boundary ──

test("the cutoff is the end of the Sydney day, not the instant of the request", () => {
  // A task due at 9am today is not "not yet due" at 8am: the date is the
  // commitment. Comparing against `now` would have made the card's contents
  // depend on the hour it was loaded.
  assert.equal(
    dueDateFilter(MIDDAY_SYDNEY).lte.toISOString(),
    "2026-09-15T13:59:59.999Z",
  );
});

test("the cutoff moves with the Sydney date, not the UTC one", () => {
  // 10pm Sydney on the 15th is still 12:00 UTC on the 15th, but 1am Sydney on
  // the 16th is 15:00 UTC on the 15th — the same UTC date, the next Sydney
  // one. A UTC-based cutoff holds yesterday's work open for ten hours.
  const lateEvening = new Date("2026-09-15T12:00:00.000Z");
  const afterMidnight = new Date("2026-09-15T15:00:00.000Z");

  assert.equal(
    dueDateFilter(lateEvening).lte.toISOString(),
    "2026-09-15T13:59:59.999Z",
  );
  assert.equal(
    dueDateFilter(afterMidnight).lte.toISOString(),
    "2026-09-16T13:59:59.999Z",
  );
});

test("the cutoff follows daylight saving", () => {
  // Sydney moves to AEDT in October. A fixed +10 would leave the last hour of
  // the day uncounted for half the year.
  const summer = new Date("2026-12-15T02:00:00.000Z");
  assert.equal(
    dueDateFilter(summer).lte.toISOString(),
    "2026-12-15T12:59:59.999Z",
  );
});

// ── What is counted ──

test("only work that is still open counts", () => {
  assert.equal(dueFollowUpTaskWhere(MIDDAY_SYDNEY).completedAt, null);
});

test("undated tasks are excluded, not treated as due", () => {
  // `LeadTask.dueDate` is nullable and null means "no date yet". That is real
  // work, but it is not work due today, and the card renders a countdown badge
  // with nothing to count from.
  assert.equal(dueDateFilter(MIDDAY_SYDNEY).not, null);
});

test("closed leads bring no follow-ups with them", () => {
  // Staging's one genuinely open overdue task belongs to a lead marked Lost.
  for (const stage of ["CONVERTED", "WON", "LOST", "CANCELLED"]) {
    assert.ok(
      CLOSED_LEAD_STAGES.includes(stage as (typeof CLOSED_LEAD_STAGES)[number]),
      `${stage} should not surface work`,
    );
  }
});

test("archived leads bring no follow-ups with them", () => {
  // createLeadTask refuses to book work on an archived lead because "every
  // read path filters through LIVE_LEAD" — which only checked the stage, so a
  // lead archived after its task was booked kept that task on every list and
  // kept both reminder crons emailing about it.
  assert.equal(LIVE_LEAD.isArchived, false);
});

test("the predicate filters on the lead, so it can be reused verbatim", () => {
  assert.deepEqual(dueFollowUpTaskWhere(MIDDAY_SYDNEY).lead, LIVE_LEAD);
});

// ── The dashboard uses it ──

test("the dashboard reads LeadTask, not the legacy columns", () => {
  const source = code("lib/data/dashboard.ts");

  assert.ok(
    !/followupCompletedAt/.test(source),
    "the dashboard is still reading a column nothing ever clears",
  );
  assert.ok(
    !/followupDate/.test(source),
    "the dashboard is still reading the legacy follow-up date",
  );
  assert.ok(
    source.includes("prisma.leadTask.findMany"),
    "the follow-up list is not reading tasks",
  );
});

test("the KPI and the card count the same thing", () => {
  const source = code("lib/data/dashboard.ts");

  // Both must go through the shared predicate. A second, hand-written copy of
  // the filter is exactly how the header and the card came to disagree.
  assert.ok(
    /prisma\.leadTask\.count\(\{\s*where: dueFollowUpTaskWhere\(now\)/.test(
      source,
    ),
    "the KPI is not counting through the shared predicate",
  );
  assert.ok(
    source.includes("where: dueFollowUpTaskWhere()"),
    "the list is not filtering through the shared predicate",
  );
});

test("no Clerk id is compared against a User.id column", () => {
  const source = code("lib/data/dashboard.ts");

  // `auth()` returns a Clerk id; `Lead.assignedId` and `LeadTask.assignedId`
  // are `User.id` uuids. Interpolating the former into SQL against the latter
  // is silent — it matches nothing and raises nothing.
  assert.ok(
    !/"assignedId"\s*=\s*\$\{userId\}/.test(source),
    "a Clerk id is being compared against an assignedId column again",
  );
});

test("the closed-stage list has one definition", () => {
  const source = code("lib/data/lead-tasks.ts");

  assert.ok(
    source.includes("CLOSED_LEAD_STAGES"),
    "lead-tasks has forked its own copy of the closed-stage list again",
  );
  assert.ok(
    !/const CLOSED_STAGES = \[/.test(source),
    "the stage list is declared in two places, which is how they drift",
  );
});
