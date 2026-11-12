import assert from "node:assert/strict";
import { test } from "vitest";

import { isRecordIdField } from "@/lib/agent/id-fields";

// The result card and the MCP approval prompt hide the same fields, so a
// record id never reaches people through either.

test("record id fields are recognised", () => {
  for (const name of [
    "id",
    "leadId",
    "offerId",
    "affectedProjectIds",
    "taskId",
  ]) {
    assert.equal(isRecordIdField(name), true, name);
  }
});

test("ordinary fields are not mistaken for ids", () => {
  for (const name of [
    "stage",
    "totalCount",
    "paid",
    "valid",
    "identity",
    "Idle",
  ]) {
    assert.equal(isRecordIdField(name), false, name);
  }
});
