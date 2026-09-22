import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildFormulaScope,
  evaluateCostFormula,
} from "@/lib/offer/formula-evaluator";
import { validateFormula } from "@/lib/offer/formula-validation";
import {
  AREA_MEASUREMENT_KEYS,
  LINE_ITEM_FORMULAS,
  DEFAULT_RATE_CONSTANTS,
  RATE_CONSTANT_KEYS,
  withDefaultRateConstants,
  type AreaMeasurementKey,
  type RateConstantKey,
} from "@/lib/offer/formula-variables";

// Simulated Phase 1 calculated values (what the Area Calculator would produce
// for a project with the given inputs and default rate constants).
const measurements: Partial<Record<AreaMeasurementKey, number>> = {
  TOTAL_SLAB_COST: 32400,
  TOTAL_DROP_EDGE_BEAM_COST: 900,
  TOTAL_TRUCK_PRICE: 1500,
  TOTAL_GROUND_FLOOR_FRAME_COST: 19387.5,
  TOTAL_FIRST_FLOOR_FRAME_COST: 13365,
  FIRST_FLOOR_AREA: 90,
  TOTAL_GROUND_FLOOR_AREA: 141,
  STEEL: 10000,
  INSTALLER: 15000,
  EAVES: 5000,
  TOTAL_BRICKS_REQUIRED: 15500,
  TOTAL_SAND_COST: 1550,
  TOTAL_CEMENT_COST: 2325,
  TIE_COST: 200,
  TOTAL_TILES_REQUIRED: 1375,
};

const rateConstants: Partial<Record<RateConstantKey, number>> = {
  ...DEFAULT_RATE_CONSTANTS,
};

const scope = buildFormulaScope(rateConstants, measurements);

// Helper: look up a formula by task name
function formulaFor(taskName: string): string {
  const entry = LINE_ITEM_FORMULAS.find((f) => f.taskName === taskName);
  assert.ok(entry, `No formula found for "${taskName}"`);
  return entry!.formula;
}

// ─── SLAB: Total slab cost − Total Drop edge beam cost ───
assert.equal(evaluateCostFormula(formulaFor("Slab"), scope), 31500);

// ─── DROP EDGE BEAM: Total Drop edge beam cost ───
assert.equal(evaluateCostFormula(formulaFor("Drop edge beam"), scope), 900);

// ─── FRAME: Total GF Frame cost + Total FF Frame cost ───
assert.equal(evaluateCostFormula(formulaFor("Frame"), scope), 32752.5);

// ─── STEEL: pass-through ───
assert.equal(evaluateCostFormula(formulaFor("Steel"), scope), 10000);

// ─── INSTALLER: pass-through ───
assert.equal(evaluateCostFormula(formulaFor("Installer"), scope), 15000);

// ─── EAVES: pass-through ───
assert.equal(evaluateCostFormula(formulaFor("Eaves"), scope), 5000);

// ─── BRICK LAYER MATERIAL WITH BARS: (sand + cement + tie) × 1.3 ───
assert.equal(
  evaluateCostFormula(formulaFor("Brick layer material with bars"), scope),
  round2((1550 + 2325 + 200) * 1.3),
);

// ─── COMMON BRICK / FACE BRICK: Total bricks × BRICK_PRICE_PER_BRICK ───
assert.equal(
  evaluateCostFormula(formulaFor("Common brick / Face brick"), scope),
  round2(15500 * 1.3),
);

// ─── BRICK LAYER: Total bricks × BRICK_LAYING_PRICE_PER_BRICK ───
assert.equal(evaluateCostFormula(formulaFor("Brick layer"), scope), 15500 * 50);

// ─── TILES: Total tiles × TILE_PRICE_PER_TILE ───
assert.equal(
  evaluateCostFormula(formulaFor("Tiles"), scope),
  round2(1375 * 28),
);

// ─── TILING: Total GF area × TILING_RATE_PER_SQM ───
assert.equal(
  evaluateCostFormula(formulaFor("Tiling"), scope),
  round2(141 * 65),
);

// ─── FLOORING: Total GF area × FLOORING_RATE_PER_SQM ───
assert.equal(
  evaluateCostFormula(formulaFor("Flooring"), scope),
  round2(141 * 60),
);

// ─── Edge case: all-zero measurements ───
const zeroMeasurements: Partial<Record<AreaMeasurementKey, number>> = {
  TOTAL_SLAB_COST: 0,
  TOTAL_DROP_EDGE_BEAM_COST: 0,
  TOTAL_TRUCK_PRICE: 0,
  TOTAL_GROUND_FLOOR_FRAME_COST: 0,
  TOTAL_FIRST_FLOOR_FRAME_COST: 0,
  FIRST_FLOOR_AREA: 0,
  TOTAL_GROUND_FLOOR_AREA: 0,
  STEEL: 0,
  INSTALLER: 0,
  EAVES: 0,
  TOTAL_BRICKS_REQUIRED: 0,
  TOTAL_SAND_COST: 0,
  TOTAL_CEMENT_COST: 0,
  TIE_COST: 0,
  TOTAL_TILES_REQUIRED: 0,
};
const zeroScope = buildFormulaScope(rateConstants, zeroMeasurements);
for (const { taskName, formula } of LINE_ITEM_FORMULAS) {
  assert.equal(
    evaluateCostFormula(formula, zeroScope),
    0,
    `Expected zero for "${taskName}" with all-zero measurements`,
  );
}

// ─── Edge case: empty formula string ───
assert.equal(evaluateCostFormula("", scope), 0);

// ─── Edge case: formula with unknown variable ───
assert.equal(evaluateCostFormula("UNKNOWN_VAR * 10", scope), 0);

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ─── Admin editor validates against the rate constants the runtime uses ───
// The cost schedule editor built its variable list from the stored overrides
// only, while the offer prefill prices with those overrides merged over
// DEFAULT_RATE_CONSTANTS. A formula using a constant the admin never overrode
// was reported as an unknown variable and kept Save disabled.

test("withDefaultRateConstants fills every rate constant, and an override wins", () => {
  const merged = withDefaultRateConstants({});
  for (const key of RATE_CONSTANT_KEYS) {
    assert.equal(merged[key], DEFAULT_RATE_CONSTANTS[key], `missing ${key}`);
  }

  assert.equal(
    withDefaultRateConstants({ KITCHEN_COST_PER_SQM: 900 })
      .KITCHEN_COST_PER_SQM,
    900,
  );
});

test("a formula using a default-only constant validates against the merged keys", () => {
  const formula = "KITCHEN_AREA * KITCHEN_COST_PER_SQM";
  const merged = [
    ...Object.keys(withDefaultRateConstants({})),
    ...AREA_MEASUREMENT_KEYS,
  ];
  const storedOnly = [...Object.keys({}), ...AREA_MEASUREMENT_KEYS];

  assert.equal(validateFormula(formula, merged).valid, true);
  assert.equal(validateFormula(formula, storedOnly).valid, false);
});
