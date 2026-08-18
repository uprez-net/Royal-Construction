import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLeadStageFilter, resolveLeadStageFilter } from "../../lib/leads/types";

test("current stage labels resolve to their DB enum member", () => {
  assert.equal(resolveLeadStageFilter("Won"), "WON");
  assert.equal(resolveLeadStageFilter("In Follow-up"), "IN_FOLLOW_UP");
  assert.equal(resolveLeadStageFilter("Cancelled"), "CANCELLED");
});

test("the retired Converted label still resolves, to Won", () => {
  // A bookmarked ?status=Converted must keep working after the label is gone.
  assert.equal(resolveLeadStageFilter("Converted"), "WON");
});

test("an unknown label resolves to undefined rather than being ignored", () => {
  assert.equal(resolveLeadStageFilter("Nonsense"), undefined);
});

test("parsing a comma-separated filter returns stages and names what failed", () => {
  assert.deepEqual(parseLeadStageFilter("Won, Negotiating"), {
    stages: ["WON", "NEGOTIATING"],
    unknown: [],
  });
  assert.deepEqual(parseLeadStageFilter("Converted"), {
    stages: ["WON"],
    unknown: [],
  });
});

test("unknown labels are reported, never silently dropped", () => {
  // The bug this guards: dropping them left an empty filter array, the stage
  // filter was skipped entirely, and the caller got EVERY lead back.
  assert.deepEqual(parseLeadStageFilter("Won,Nonsense"), {
    stages: ["WON"],
    unknown: ["Nonsense"],
  });
  assert.deepEqual(parseLeadStageFilter("Nonsense"), {
    stages: [],
    unknown: ["Nonsense"],
  });
});

test("blank and whitespace-only segments are ignored, not treated as unknown", () => {
  assert.deepEqual(parseLeadStageFilter("Won, ,"), { stages: ["WON"], unknown: [] });
  assert.deepEqual(parseLeadStageFilter(""), { stages: [], unknown: [] });
});

test("inherited Object.prototype members are not stages", () => {
  // A bare `map[label]` lookup resolves these to FUNCTIONS off the prototype
  // chain. They then passed the unknown-label guard and were pushed into the
  // array that becomes a Prisma `where` clause.
  for (const label of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
    assert.equal(resolveLeadStageFilter(label), undefined, label);
  }
  const parsed = parseLeadStageFilter("toString,constructor");
  assert.deepEqual(parsed.stages, []);
  assert.deepEqual(parsed.unknown, ["toString", "constructor"]);
});

test("__proto__ is not a stage", () => {
  assert.equal(resolveLeadStageFilter("__proto__"), undefined);
  assert.deepEqual(parseLeadStageFilter("__proto__"), {
    stages: [],
    unknown: ["__proto__"],
  });
});

test("every resolved value is a real DB stage string", () => {
  for (const label of ["Won", "Converted", "Cancelled", "toString", "nope"]) {
    const v = resolveLeadStageFilter(label);
    if (v !== undefined) assert.equal(typeof v, "string", label);
  }
});
