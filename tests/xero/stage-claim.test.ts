import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contractClaimTotal,
  resolveStageClaims,
} from "../../lib/projects/stage-claim";

const BUDGET = 900_000;

test("falls back to the static NSW schedule when no contract stages exist", () => {
  const claims = resolveStageClaims(null, BUDGET);

  // The static table holds fractions (0.05) while stageClaimAmount divides by
  // 100, so the conversion has to happen on the way in. Without it every claim
  // comes out 100x too small.
  assert.equal(claims.Deposit.percentage, 5);
  assert.equal(claims.Deposit.claim, 45_000);
  assert.equal(claims.Slab.claim, 135_000);
  assert.equal(claims.Frame.claim, 225_000);
  assert.equal(claims.Lockup.claim, 225_000);
  assert.equal(claims.Interior_Fit_Out.claim, 180_000);
  assert.equal(claims.Final.claim, 90_000);
});

test("the fallback schedule adds up to the whole budget", () => {
  assert.equal(contractClaimTotal(resolveStageClaims(null, BUDGET)), BUDGET);
});

// The contract's own dollar figure is what the owner agreed to pay, and the sum
// it came from can differ from the project budget — so it must win outright.
test("a contract amount beats both percentages", () => {
  const claims = resolveStageClaims(
    [{ label: "Slab 15%", percentage: 15, amount: 140_000 }],
    BUDGET,
  );

  assert.equal(claims.Slab.claim, 140_000);
});

test("a contract percentage beats the static table", () => {
  const claims = resolveStageClaims(
    [{ label: "Frame 30%", percentage: 30, amount: null }],
    BUDGET,
  );

  assert.equal(claims.Frame.percentage, 30);
  assert.equal(claims.Frame.claim, 270_000);
  // Stages the contract does not mention keep the static schedule.
  assert.equal(claims.Deposit.claim, 45_000);
});

test("an unusable budget leaves percentage-only stages unknown, not zero", () => {
  const claims = resolveStageClaims(null, Number.NaN);

  assert.equal(claims.Deposit.claim, null);
  assert.equal(contractClaimTotal(claims), null);
});

// A stage with no budget behind it still resolves when the contract states a
// dollar amount, because that amount stands on its own.
test("a contract amount survives an unusable budget", () => {
  const claims = resolveStageClaims(
    [{ label: "Deposit", percentage: null, amount: 50_000 }],
    Number.NaN,
  );

  assert.equal(claims.Deposit.claim, 50_000);
  assert.equal(contractClaimTotal(claims), 50_000);
});

test("a zero budget yields zero claims rather than nulls", () => {
  const claims = resolveStageClaims(null, 0);

  assert.equal(claims.Slab.claim, 0);
});
