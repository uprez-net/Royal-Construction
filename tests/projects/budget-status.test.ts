import assert from "node:assert/strict";

import { getBudgetStatus } from "../../lib/utils/project-budget-status";

// Positive contract with `spent === 0` is NOT_STARTED, not a degenerate
// ON_BUDGET: nothing has been recorded yet.
assert.equal(getBudgetStatus(100_000, 0), "NOT_STARTED");

// Spend has passed the contract value.
assert.equal(getBudgetStatus(100_000, 150_000), "OVER_BUDGET");
assert.equal(getBudgetStatus(100_000, 100_001), "OVER_BUDGET");

// Positive contract: spend is tracking within budget.
assert.equal(getBudgetStatus(100_000, 1), "ON_BUDGET");
assert.equal(getBudgetStatus(100_000, 50_000), "ON_BUDGET");
assert.equal(getBudgetStatus(100_000, 100_000), "ON_BUDGET");

// No contract value recorded yet.
assert.equal(getBudgetStatus(0, 0), "NOT_STARTED");
assert.equal(getBudgetStatus(0, 50_000), "NOT_STARTED");
assert.equal(getBudgetStatus(-1, 50_000), "NOT_STARTED");

// Non-finite inputs must not leak through as ON_BUDGET/OVER_BUDGET.
assert.equal(getBudgetStatus(NaN, 50_000), "NOT_STARTED");
assert.equal(getBudgetStatus(Infinity, 50_000), "NOT_STARTED");
assert.equal(getBudgetStatus(-Infinity, 50_000), "NOT_STARTED");
assert.equal(getBudgetStatus(100_000, NaN), "NOT_STARTED");
assert.equal(getBudgetStatus(100_000, Infinity), "NOT_STARTED");
