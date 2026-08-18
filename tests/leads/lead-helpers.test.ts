import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLikelihood } from "../../lib/leads/lead-helpers";

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
