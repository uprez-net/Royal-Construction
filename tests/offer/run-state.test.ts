import assert from "node:assert/strict";
import { getOfferRunStartDecision } from "../../lib/offer/run-state";

assert.deepEqual(
  getOfferRunStartDecision({ runId: "run-active", runStatus: "RUNNING" }),
  {
    kind: "reuse",
    runId: "run-active",
    message: "Offer creation workflow already in progress",
  },
);

assert.deepEqual(
  getOfferRunStartDecision({ runId: "run-failed", runStatus: "FAILED" }),
  {
    kind: "start",
    clearStaleRun: true,
  },
);

assert.deepEqual(
  getOfferRunStartDecision({ runId: "run-complete", runStatus: "COMPLETED" }),
  {
    kind: "start",
    clearStaleRun: true,
  },
);

assert.deepEqual(getOfferRunStartDecision({ runId: null, runStatus: null }), {
  kind: "start",
  clearStaleRun: false,
});

