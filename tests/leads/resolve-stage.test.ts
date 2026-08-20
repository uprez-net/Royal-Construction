import assert from "node:assert/strict";
import { test } from "node:test";

import { closeDatePatch } from "../../lib/leads/pipeline-stages";
import { resolveLeadStage } from "../../lib/leads/resolve-stage";

test("no stage input and no follow-up outcome writes nothing", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "QUALIFIED" }),
    undefined,
  );
});

test("an explicit stage passes straight through", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "NEW", requestedStage: "QUOTED" }),
    "QUOTED",
  );
});

test("answering a follow-up moves IN_FOLLOW_UP to CONTACTED", () => {
  for (const outcome of ["yes", "notRequired"] as const) {
    assert.equal(
      resolveLeadStage({
        currentStage: "IN_FOLLOW_UP",
        followupResponseOutcome: outcome,
      }),
      "CONTACTED",
      `outcome ${outcome}`,
    );
  }
});

test("answering a follow-up leaves a lead that is not IN_FOLLOW_UP alone", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "QUALIFIED", followupResponseOutcome: "yes" }),
    undefined,
  );
});

test("rescheduling moves an open lead to IN_FOLLOW_UP", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "QUOTED", followupResponseOutcome: "reschedule" }),
    "IN_FOLLOW_UP",
  );
});

test("rescheduling moves a stalled lead to IN_FOLLOW_UP", () => {
  assert.equal(
    resolveLeadStage({ currentStage: "NO_RESPONSE", followupResponseOutcome: "reschedule" }),
    "IN_FOLLOW_UP",
  );
});

test("rescheduling never reopens a closed lead", () => {
  for (const stage of ["WON", "LOST", "CANCELLED", "DISQUALIFIED"] as const) {
    assert.equal(
      resolveLeadStage({ currentStage: stage, followupResponseOutcome: "reschedule" }),
      undefined,
      `${stage} must not be dragged back to IN_FOLLOW_UP`,
    );
  }
});

test("rescheduling does not override an explicit close in the same payload", () => {
  // The regression: this used to save stage IN_FOLLOW_UP while closeDatePatch
  // had already stamped wonAt from the requested WON.
  assert.equal(
    resolveLeadStage({
      currentStage: "NEGOTIATING",
      requestedStage: "WON",
      followupResponseOutcome: "reschedule",
    }),
    "WON",
  );
});

test("rescheduling still applies when the explicit stage is itself open", () => {
  assert.equal(
    resolveLeadStage({
      currentStage: "NEW",
      requestedStage: "QUALIFIED",
      followupResponseOutcome: "reschedule",
    }),
    "IN_FOLLOW_UP",
  );
});

test("the resolved stage and the close-date stamp always agree", () => {
  // The invariant the whole forecast rests on: outcome WON <=> wonAt set.
  const now = new Date("2026-08-18T00:00:00.000Z");

  const won = resolveLeadStage({
    currentStage: "NEGOTIATING",
    requestedStage: "WON",
    followupResponseOutcome: "reschedule",
  });
  assert.equal(won, "WON");
  assert.deepEqual(closeDatePatch("NEGOTIATING", won!, now), { wonAt: now, lostAt: null });

  const reopened = resolveLeadStage({
    currentStage: "QUOTED",
    followupResponseOutcome: "reschedule",
  });
  assert.equal(reopened, "IN_FOLLOW_UP");
  // Open -> open stamps nothing, and defensively clears any stale close date.
  assert.deepEqual(closeDatePatch("QUOTED", reopened!, now), { wonAt: null, lostAt: null });

  // A won lead touched only by a reschedule keeps both its stage and its stamp.
  assert.equal(
    resolveLeadStage({ currentStage: "WON", followupResponseOutcome: "reschedule" }),
    undefined,
  );
});
