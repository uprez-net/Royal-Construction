import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAD_STAGE_OPTIONS,
  closureReasonCopy,
  parseLikelihood,
} from "../../lib/leads/lead-helpers";

test("blank likelihood means no override", () => {
  assert.equal(parseLikelihood(""), null);
  assert.equal(parseLikelihood("   "), null);
});

test("unparseable likelihood means no override, not zero", () => {
  // The regression: `Number(raw) || 0` turned a typo into a real 0% forecast,
  // silently removing the deal's weighted contribution.
  for (const raw of ["abc", "1e", "--5", "12px", "NaN"]) {
    assert.equal(parseLikelihood(raw), null, `"${raw}" must not become 0`);
  }
});

test("valid likelihood is rounded and clamped to 0-100", () => {
  assert.equal(parseLikelihood("70"), 70);
  assert.equal(parseLikelihood("79.6"), 80);
  assert.equal(parseLikelihood("150"), 100);
  assert.equal(parseLikelihood("-20"), 0);
  assert.equal(parseLikelihood("0"), 0);
});

test("an explicit zero is preserved as a real override", () => {
  assert.equal(parseLikelihood("0"), 0);
  assert.notEqual(parseLikelihood("0"), null);
});

/* ── closureReasonCopy ─────────────────────────────────────────────── */

test("cancelled leads ask for a cancellation reason, not a lost reason", () => {
  const c = closureReasonCopy("Cancelled");
  assert.equal(c.label, "Cancellation reason");
  assert.equal(c.noun, "cancellation reason");
  assert.match(c.placeholder, /postponed|finance/i);
});

test("every other closed-unsuccessful stage keeps the lost wording", () => {
  for (const stage of ["Lost", "Disqualified"] as const) {
    assert.equal(closureReasonCopy(stage).label, "Lost reason", stage);
  }
});

test("the stage select offers exactly one terminal-won label", () => {
  // Converted and Won were indistinguishable in every calculation; offering
  // both is what this change removes.
  assert.ok(LEAD_STAGE_OPTIONS.includes("Won"));
  assert.ok(!LEAD_STAGE_OPTIONS.includes("Converted" as never));
  assert.ok(LEAD_STAGE_OPTIONS.includes("Cancelled"));
});
