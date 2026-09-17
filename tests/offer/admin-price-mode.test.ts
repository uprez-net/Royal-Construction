import assert from "node:assert/strict";
import { test } from "node:test";

import { withMode } from "../../components/offers/admin/shared/price-mode";
import { costScheduleRowSchema } from "../../lib/validations/admin-offer-content";
import type {
  CostScheduleRow,
  CostScheduleRowBase,
} from "../../types/admin-offer-content";

// Changing a cost schedule row's price mode rebuilt the row with `value: 0` or
// `formula: ""`. Picking the wrong mode and switching straight back therefore
// wiped the admin's price or formula, and nothing on screen said so.

const base: CostScheduleRowBase = {
  id: "row-1",
  taskKey: "slab",
  phase: "SLAB",
  task: "Slab",
  defaultInclude: true,
};

test("fixed 18500 -> formula -> fixed keeps 18500", () => {
  const fixed: CostScheduleRow = { ...base, priceMode: "fixed", value: 18_500 };

  const formula = withMode(fixed, "formula");
  assert.equal(formula.priceMode, "formula");

  const back = withMode(formula, "fixed");
  assert.equal(back.priceMode, "fixed");
  assert.equal(back.priceMode === "fixed" ? back.value : undefined, 18_500);
});

test("formula 'A*B' -> none -> formula keeps 'A*B'", () => {
  const formula: CostScheduleRow = {
    ...base,
    priceMode: "formula",
    formula: "A*B",
  };

  const back = withMode(withMode(formula, "none"), "formula");
  assert.equal(back.priceMode === "formula" ? back.formula : undefined, "A*B");
});

test("a fresh none row switched to fixed starts at 0", () => {
  const none: CostScheduleRow = { ...base, priceMode: "none" };

  const fixed = withMode(none, "fixed");
  assert.equal(fixed.priceMode === "fixed" ? fixed.value : undefined, 0);
});

test("the value kept for a round trip is not what gets saved", () => {
  const fixed: CostScheduleRow = { ...base, priceMode: "fixed", value: 18_500 };
  const saved = costScheduleRowSchema.parse(withMode(fixed, "formula"));

  assert.equal(saved.priceMode, "formula");
  assert.equal("value" in saved, false);
});
