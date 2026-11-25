import assert from "node:assert/strict";
import { test } from "vitest";

import { reevaluateFormulaCostLines } from "@/lib/offer/admin-offer-prefill";
import { CURRENT_CALC_VERSION } from "@/lib/offer/calc-version";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import {
  INITIAL_AREA_CALCULATOR,
  calculateFrame,
  calculateSlab,
  calculateTiles,
  offerAreaBasisFromJob,
  offerTotalBathrooms,
  rawTotalAreaSqm,
} from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  type OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  deserializeWorkspace,
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { buildAreaBreakdown } from "@/lib/offer/workspace-print-template";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// A granny home can have a second floor. Only its area is captured — the
// granny's rooms are its own counts, whichever floor they are on — and it never
// touches the major house: no bedrooms, no bathrooms, no slab. While both
// "Includes a granny home" and the granny's "Includes a second floor" are on,
// the area counts toward the printed total and prices like an upper floor;
// with either off, whatever is stored does none of that.

function snapshotWithJob(
  job: Partial<OfferWorkspaceJob>,
): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, ...job },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
    calcVersion: CURRENT_CALC_VERSION,
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
  };
}

const WITH_GRANNY = {
  groundFloorSqm: 150,
  firstFloorSqm: 120,
  garageSqm: 40,
  bedrooms: 4,
  bathrooms: 2.5,
  garageSpaces: 2,
  hasGrannyHome: true,
  grannyFlatSqm: 60,
  grannyBedrooms: 2,
  grannyBathrooms: 1,
  grannyGarageSpaces: 1,
};

const WITHOUT = snapshotWithJob(WITH_GRANNY);

const WITH = snapshotWithJob({
  ...WITH_GRANNY,
  grannyHasSecondFloor: true,
  grannySecondFloorSqm: 45,
});

// The same figure stored, with the granny's second floor turned back off.
const SECOND_FLOOR_OFF = snapshotWithJob({
  ...WITH.job,
  grannyHasSecondFloor: false,
});

// The same figure stored, with the whole granny home turned off.
const GRANNY_OFF = snapshotWithJob({
  ...WITH.job,
  hasGrannyHome: false,
  grannyFlatSqm: 0,
});

test("a new job starts with no granny second floor", () => {
  assert.equal(INITIAL_OFFER_JOB.grannyHasSecondFloor, false);
  assert.equal(INITIAL_OFFER_JOB.grannySecondFloorSqm, 0);
});

test("the granny second floor survives a persistence round-trip", () => {
  const restored = deserializeWorkspace(
    parseWorkspaceState(serializeWorkspace(WITH)),
  );

  assert.equal(restored.job.grannyHasSecondFloor, true);
  assert.equal(restored.job.grannySecondFloorSqm, 45);
});

test("an offer persisted before the granny second floor existed still parses", () => {
  const persisted = serializeWorkspace(WITHOUT);
  const job = persisted.job as Record<string, unknown>;
  delete job.grannyHasSecondFloor;
  delete job.grannySecondFloorSqm;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.job.grannyHasSecondFloor, false);
  assert.equal(restored.job.grannySecondFloorSqm, 0);
});

test("the area joins the total only while the granny home and its second floor are on", () => {
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(WITHOUT.job)), 370);
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(WITH.job)), 415);
  assert.equal(
    rawTotalAreaSqm(offerAreaBasisFromJob(SECOND_FLOOR_OFF.job)),
    370,
  );
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(GRANNY_OFF.job)), 310);
});

test("the area grid carries a Granny Second Floor cell that adds up to the total", () => {
  const breakdown = buildAreaBreakdown(WITH.job);
  const cell = breakdown.cells.find(
    (entry) => entry.label === "Granny Second Floor",
  );

  assert.equal(cell?.sqm, 45);
  assert.equal(
    breakdown.cells.reduce((sum, entry) => sum + entry.sqm, 0),
    breakdown.totalSqm,
  );
  for (const snapshot of [SECOND_FLOOR_OFF, GRANNY_OFF]) {
    assert.equal(
      buildAreaBreakdown(snapshot.job).cells.some(
        (entry) => entry.label === "Granny Second Floor",
      ),
      false,
    );
  }
});

test("the granny second floor is framed at the upper-floor rate under both rules", () => {
  const rates = {
    groundFloorFramePricePerSqm: 100,
    firstFloorFramePricePerSqm: 150,
  };
  const area = { steel: 0, installer: 0, eaves: 0 };
  for (const version of [LEGACY_CALC_VERSION, CURRENT_CALC_VERSION]) {
    const without = calculateFrame(
      offerAreaBasisFromJob(WITHOUT.job),
      area,
      rates,
      version,
    );
    const withFloor = calculateFrame(
      offerAreaBasisFromJob(WITH.job),
      area,
      rates,
      version,
    );
    assert.equal(
      withFloor.totalFirstFloorArea,
      without.totalFirstFloorArea + 45,
    );
    assert.equal(withFloor.totalGroundFloorArea, without.totalGroundFloorArea);
  }
});

test("the granny second floor is not slab, ground tiles or extra rooms", () => {
  const rates = {
    dropEdgeBeamCostPerSurfaceArea: 0,
    priceOfEachTruck: 0,
    slabCostPerSqm: 100,
  };
  const slab = (job: OfferWorkspaceJob) =>
    calculateSlab(offerAreaBasisFromJob(job), INITIAL_AREA_CALCULATOR, rates)
      .slabCost;
  assert.equal(slab(WITH.job), slab(WITHOUT.job));

  const tiles = (job: OfferWorkspaceJob) =>
    calculateTiles(offerAreaBasisFromJob(job), offerTotalBathrooms(job));
  assert.deepEqual(tiles(WITH.job), tiles(WITHOUT.job));
  assert.equal(offerTotalBathrooms(WITH.job), offerTotalBathrooms(WITHOUT.job));
});

test("the cost formulas read the granny second floor's area and flooring, not bedrooms", () => {
  // Each formula is scaled so the round-up to the next $1,000 cannot hide a
  // difference.
  const lines = ["TOTAL_AREA", "TOTAL_FLOORING_AREA", "TOTAL_BEDROOMS"].map(
    (variable, index) => ({
      ...INITIAL_COST_LINES[0],
      id: `formula-${index}`,
      formula: `${variable} * 1000`,
      costExGst: 0,
    }),
  );
  const price = (job: OfferWorkspaceJob) =>
    reevaluateFormulaCostLines(
      lines,
      {},
      job,
      INITIAL_AREA_CALCULATOR,
      CURRENT_CALC_VERSION,
    ).map((line) => line.costExGst / 1000);

  assert.deepEqual(price(WITHOUT.job), [370, 120, 6]);
  assert.deepEqual(price(WITH.job), [415, 165, 6]);
  assert.deepEqual(price(SECOND_FLOOR_OFF.job), [370, 120, 6]);
});

test("the proposal prints the granny second floor only when it counts", () => {
  const withHtml = buildProposalHtml(buildProposalInput(WITH), WITH.images);
  assert.match(withHtml, /Granny Second Floor<\/div>/);
  assert.doesNotMatch(withHtml, /Second Floor Specifications/);

  for (const snapshot of [WITHOUT, SECOND_FLOOR_OFF, GRANNY_OFF]) {
    const html = buildProposalHtml(
      buildProposalInput(snapshot),
      snapshot.images,
    );
    assert.doesNotMatch(html, /Second Floor/);
  }
});

test("the tender's total build area carries the granny second floor", () => {
  assert.match(buildTenderHtml(buildProposalInput(WITH)), /415 m²/);
  assert.doesNotMatch(
    buildTenderHtml(buildProposalInput(SECOND_FLOOR_OFF)),
    /415 m²/,
  );
});
