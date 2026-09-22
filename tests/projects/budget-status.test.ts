import assert from "node:assert/strict";
import { test } from "vitest";

import { getBudgetStatus } from "@/lib/utils/project-budget-status";

test("a positive contract with nothing spent is NOT_STARTED", () => {
  // Positive contract with `spent === 0` is NOT_STARTED, not a degenerate
  // ON_BUDGET: nothing has been recorded yet.
  assert.equal(getBudgetStatus(100_000, 0), "NOT_STARTED");
});

test("spend past the contract value is OVER_BUDGET, down to the cent", () => {
  assert.equal(getBudgetStatus(100_000, 150_000), "OVER_BUDGET");
  assert.equal(getBudgetStatus(100_000, 100_001), "OVER_BUDGET");
});

test("spend up to and including the contract value is ON_BUDGET", () => {
  assert.equal(getBudgetStatus(100_000, 1), "ON_BUDGET");
  assert.equal(getBudgetStatus(100_000, 50_000), "ON_BUDGET");
  assert.equal(getBudgetStatus(100_000, 100_000), "ON_BUDGET");
});

test("no contract value recorded yet is NOT_STARTED, whatever the spend", () => {
  assert.equal(getBudgetStatus(0, 0), "NOT_STARTED");
  assert.equal(getBudgetStatus(0, 50_000), "NOT_STARTED");
  assert.equal(getBudgetStatus(-1, 50_000), "NOT_STARTED");
});

test("non-finite inputs do not leak through as ON_BUDGET/OVER_BUDGET", () => {
  assert.equal(getBudgetStatus(NaN, 50_000), "NOT_STARTED");
  assert.equal(getBudgetStatus(Infinity, 50_000), "NOT_STARTED");
  assert.equal(getBudgetStatus(-Infinity, 50_000), "NOT_STARTED");
  assert.equal(getBudgetStatus(100_000, NaN), "NOT_STARTED");
  assert.equal(getBudgetStatus(100_000, Infinity), "NOT_STARTED");
});
