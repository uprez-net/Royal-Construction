import assert from "node:assert/strict";
import { test } from "vitest";
import {
  needsReviewWindow,
  sameListQuery,
} from "@/lib/tradie-approvals/queue-order";

// The approvals screen's guards. The slice that uses them imports server
// actions, so they live in the pure queue module and are tested here.

test("removals and incidents never approve in one click", () => {
  assert.equal(needsReviewWindow({ actionType: "TRADIE_REMOVAL" }), true);
  assert.equal(needsReviewWindow({ actionType: "INCIDENT_RESOLUTION" }), true);
  for (const actionType of [
    "SCHEDULE_APPROVAL",
    "SCHEDULE_DELETION",
    "TRADE_CANCELLATION",
    "PRICE_CHANGE",
  ]) {
    assert.equal(needsReviewWindow({ actionType }), false, actionType);
  }
});

test("a list result applies only to the query that asked for it", () => {
  const base = { view: "needs-decision", page: 1, search: "" };
  assert.equal(sameListQuery(base, { ...base, search: undefined }), true);
  assert.equal(sameListQuery(base, { ...base, view: "decided" }), false);
  assert.equal(sameListQuery(base, { ...base, page: 2 }), false);
  assert.equal(sameListQuery(base, { ...base, type: "TRADIE_REMOVAL" }), false);
  assert.equal(sameListQuery(base, { ...base, due: "week" }), false);
  assert.equal(sameListQuery(base, { ...base, search: "smith" }), false);
});
