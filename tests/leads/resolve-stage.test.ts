import assert from "node:assert/strict";
import { test } from "vitest";

import { PIPELINE_STAGES, closeDatePatch } from "@/lib/leads/pipeline-stages";
import { resolveLeadStage } from "@/lib/leads/resolve-stage";

test("nothing to say means nothing is written", () => {
  assert.equal(resolveLeadStage({ currentStage: "QUALIFIED" }), undefined);
});

test("an explicit stage passes straight through", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "NEW", requestedStage: "QUOTED" }),
    "QUOTED",
  );
});

test("a person's choice beats anything inferred from a task", () => {
  // Both arrive together on updateLeadSchema and both are on the MCP surface.
  assert.equal(
    resolveLeadStage({
      currentStage: "NEW",
      requestedStage: "LOST",
      taskScheduled: true,
    }),
    "LOST",
  );
});

/* ── scheduling work ───────────────────────────────────────────────── */

test("booking work on an unworked lead starts Discovery", () => {
  for (const from of ["NEW", "CONTACTED"] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: from, taskScheduled: true }),
      "DISCOVERY",
      from,
    );
  }
});

test("booking work never moves a lead that is already further on", () => {
  // The defect this replaces: a reschedule dragged ANY open lead to
  // IN_FOLLOW_UP at 45%, so a deal in negotiation lost 30 points to a calendar
  // action and another 25 when someone answered.
  for (const from of [
    "DISCOVERY",
    "QUALIFIED",
    "QUOTED",
    "NEGOTIATING",
  ] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: from, taskScheduled: true }),
      undefined,
      from,
    );
  }
});

test("booking work never reopens a closed lead", () => {
  for (const from of [
    "CONVERTED",
    "LOST",
    "DISQUALIFIED",
    "NO_RESPONSE",
  ] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: from, taskScheduled: true }),
      undefined,
      `${from} must not be dragged open by a calendar action`,
    );
  }
});

test("a retired stage is not treated as earlier than Discovery", () => {
  // Rows still hold these until the data migration runs everywhere. They are
  // worth 30%, the same as Discovery, so an unrelated reschedule must not shove
  // them forward. This is why the check compares probability, not `order`:
  // both sort AFTER Discovery in the display sequence.
  for (const from of ["IN_FOLLOW_UP", "MEETING_SCHEDULED"] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: from, taskScheduled: true }),
      undefined,
      from,
    );
  }
});

test("completing a task is not a scheduling event and writes no stage", () => {
  // Answering a follow-up used to write CONTACTED. That single line put 6 of
  // the 11 Contacted leads on production where they are.
  //
  // Checked at both ends of the ladder. An early lead matters as much as a late
  // one here: NEW and CONTACTED are the two stages the advance rule DOES fire
  // for, so if completion were ever mistaken for scheduling, they are where it
  // would show up first.
  for (const from of [
    "NEW",
    "CONTACTED",
    "DISCOVERY",
    "NEGOTIATING",
  ] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: from, taskScheduled: false }),
      undefined,
      from,
    );
    assert.equal(
      resolveLeadStage({ currentStage: from }),
      undefined,
      `${from} (omitted)`,
    );
  }
});

/* ── the invariant the forecast rests on ───────────────────────────── */

test("the resolved stage and the close-date stamp always agree", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");

  const won = resolveLeadStage({
    currentStage: "NEGOTIATING",
    requestedStage: "CONVERTED",
    taskScheduled: true,
  });
  assert.equal(won, "CONVERTED");
  assert.deepEqual(closeDatePatch("NEGOTIATING", won!, now), {
    wonAt: now,
    lostAt: null,
  });

  const started = resolveLeadStage({
    currentStage: "NEW",
    taskScheduled: true,
  });
  assert.equal(started, "DISCOVERY");
  assert.deepEqual(closeDatePatch("NEW", started!, now), {
    wonAt: null,
    lostAt: null,
  });
});

test("Discovery sits between Contacted and Qualified", () => {
  // The whole advance rule reads off these numbers.
  assert.ok(
    PIPELINE_STAGES.CONTACTED.probability
      < PIPELINE_STAGES.DISCOVERY.probability,
  );
  assert.ok(
    PIPELINE_STAGES.DISCOVERY.probability
      < PIPELINE_STAGES.QUALIFIED.probability,
  );
  assert.equal(PIPELINE_STAGES.DISCOVERY.outcome, "OPEN");
});
