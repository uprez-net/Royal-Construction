import assert from "node:assert/strict";
import { test } from "vitest";

import {
  reevaluateFormulaCostLines,
  reevaluateFormulaCostLinesForStatus,
} from "@/lib/offer/admin-offer-prefill";
import {
  INITIAL_AREA_CALCULATOR,
  calculateOfferArea,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  CURRENT_CALC_VERSION,
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  isSupportedCalcVersion,
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";

// The promise this file exists to enforce: an offer that already had a saved
// workspace before the calculation pin shipped keeps pricing on the old rules
// forever. If any assertion here fails, an existing customer quote has moved.

const BASE_SNAPSHOT: OfferWorkspaceSnapshot = {
  job: {
    ...INITIAL_OFFER_JOB,
    // A void-bearing double-storey build: the only shape the two rule sets
    // disagree about.
    groundFloorSqm: 185,
    firstFloorSqm: 145,
    garageSqm: 38,
    alfrescoPorchSqm: 25,
    porchSqm: 8,
    balconySqm: 12,
    voidSqm: 15,
  },
  lines: INITIAL_COST_LINES,
  allowances: INITIAL_ALLOWANCES,
  exclusions: INITIAL_EXCLUSIONS,
  draft: INITIAL_OFFER_DRAFT,
  areaCalculator: INITIAL_AREA_CALCULATOR,
  workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
  paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: EMPTY_OFFER_IMAGES,
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 0,
  rateCardProduct: "DOUBLE_STOREY",
  rateCardTier: "STANDARD",
  calcVersion: LEGACY_CALC_VERSION,
};

test("an offer saved before the pin existed parses as legacy, not as current", () => {
  // Exactly the shape of the 14 rows already in production: no calcVersion key.
  const persisted = serializeWorkspace(BASE_SNAPSHOT) as Record<
    string,
    unknown
  >;
  delete persisted.calcVersion;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.calcVersion, LEGACY_CALC_VERSION);
  assert.notEqual(restored.calcVersion, CURRENT_CALC_VERSION);
});

test("the pin survives a persistence round-trip in both directions", () => {
  for (const version of [LEGACY_CALC_VERSION, CURRENT_CALC_VERSION] as const) {
    const restored = deserializeWorkspace(
      parseWorkspaceState(
        serializeWorkspace({ ...BASE_SNAPSHOT, calcVersion: version }),
      ),
    );
    assert.equal(restored.calcVersion, version);
  }
});

test("an unrecognised version survives intact and is refused, not downgraded", () => {
  // A row written by a future build, opened by this one. Reading it as v1 would
  // have repriced it under rules it was never quoted on, so the version is kept
  // exactly as stored and rejected at the point of calculation instead.
  const persisted = serializeWorkspace(BASE_SNAPSHOT) as Record<
    string,
    unknown
  >;
  persisted.calcVersion = 99;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.calcVersion, 99);
  assert.notEqual(restored.calcVersion, LEGACY_CALC_VERSION);
  assert.equal(isSupportedCalcVersion(restored.calcVersion), false);
  // Both versions this build does carry are supported.
  assert.equal(isSupportedCalcVersion(LEGACY_CALC_VERSION), true);
  assert.equal(isSupportedCalcVersion(CURRENT_CALC_VERSION), true);
});

test("the two rule sets disagree only about the void, and only in the frame", () => {
  const basis = offerAreaBasisFromJob(BASE_SNAPSHOT.job);
  const rates = {
    dropEdgeBeamCostPerSurfaceArea: 30,
    priceOfEachTruck: 500,
    groundFloorFramePricePerSqm: 137.5,
    firstFloorFramePricePerSqm: 148.5,
    sandRatePerThousandBricks: 1,
    cementRatePerHundredBricks: 1,
    brickPricePerBrick: 1,
    brickLayingPricePerBrick: 1,
    tilePricePerTile: 1,
    tilingRatePerSqm: 1,
    flooringRatePerSqm: 1,
    slabCostPerSqm: 200,
  };

  const v1 = calculateOfferArea(
    basis,
    INITIAL_AREA_CALCULATOR,
    rates,
    LEGACY_CALC_VERSION,
    0,
  );
  const v2 = calculateOfferArea(
    basis,
    INITIAL_AREA_CALCULATOR,
    rates,
    CURRENT_CALC_VERSION,
    0,
  );

  // The first floor gains the 15 m² void under v2.
  assert.equal(v1.totalFirstFloorArea, 157);
  assert.equal(v2.totalFirstFloorArea, 172);

  // Nothing outside the frame moves. The slab in particular must not, or the
  // "documents only" characterisation of this change would be wrong.
  assert.equal(v1.totalSlabCost, v2.totalSlabCost);
  assert.equal(v1.slabCost, v2.slabCost);
  assert.equal(v1.totalGroundFloorArea, v2.totalGroundFloorArea);
  assert.equal(v1.totalGroundFloorFrameCost, v2.totalGroundFloorFrameCost);
  assert.equal(v1.totalBricksRequired, v2.totalBricksRequired);
  assert.equal(v1.totalTilesRequired, v2.totalTilesRequired);
});

test("the reprice-on-open path honours the offer's own rules", () => {
  // reevaluateFormulaCostLines is the bridge from a display calculation to
  // persisted money, and it runs on every open of an editable offer. Handing it
  // a legacy offer must reproduce legacy numbers.
  const withFormula = [
    {
      ...INITIAL_COST_LINES[0],
      formula: "TOTAL_FIRST_FLOOR_FRAME_COST",
      costExGst: 0,
    },
  ];
  const rateConstants = { FRAME_FIRST_RATE_PER_SQM: 148.5 } as Parameters<
    typeof reevaluateFormulaCostLines
  >[1];

  const legacy = reevaluateFormulaCostLines(
    withFormula,
    rateConstants,
    BASE_SNAPSHOT.job,
    INITIAL_AREA_CALCULATOR,
    LEGACY_CALC_VERSION,
  );
  const current = reevaluateFormulaCostLines(
    withFormula,
    rateConstants,
    BASE_SNAPSHOT.job,
    INITIAL_AREA_CALCULATOR,
    CURRENT_CALC_VERSION,
  );

  // Same inputs, different rules, therefore different money — which is exactly
  // why the version must never be taken from the client.
  assert.notEqual(legacy[0].costExGst, current[0].costExGst);
  assert.ok(current[0].costExGst > legacy[0].costExGst);
});

test("an issued offer's formula lines keep their price when admin rates change", () => {
  // The workspace re-ran formula evaluation whenever the job or area calculator
  // changed, which a reload does. An issued offer's cost lines were re-priced
  // from today's admin rate constants, so the quote moved with nobody editing it.
  const quoted = [
    {
      ...INITIAL_COST_LINES[0],
      formula: "TOTAL_FIRST_FLOOR_FRAME_COST",
      costExGst: 21_000,
    },
  ];
  const changedRates = { FRAME_FIRST_RATE_PER_SQM: 999 } as Parameters<
    typeof reevaluateFormulaCostLines
  >[1];

  for (const status of ["sent", "agreed", "tender_draft"] as const) {
    const lines = reevaluateFormulaCostLinesForStatus(
      status,
      quoted,
      changedRates,
      BASE_SNAPSHOT.job,
      INITIAL_AREA_CALCULATOR,
      CURRENT_CALC_VERSION,
    );
    assert.equal(lines[0].costExGst, 21_000, status);
    assert.equal(lines, quoted, `${status} should hand back the same lines`);
  }

  // While pending the estimator is still pricing, so the new rates apply.
  const pending = reevaluateFormulaCostLinesForStatus(
    "pending",
    quoted,
    changedRates,
    BASE_SNAPSHOT.job,
    INITIAL_AREA_CALCULATOR,
    CURRENT_CALC_VERSION,
  );
  assert.notEqual(pending[0].costExGst, 21_000);
  assert.equal(
    pending[0].costExGst,
    reevaluateFormulaCostLines(
      quoted,
      changedRates,
      BASE_SNAPSHOT.job,
      INITIAL_AREA_CALCULATOR,
      CURRENT_CALC_VERSION,
    )[0].costExGst,
  );
});
