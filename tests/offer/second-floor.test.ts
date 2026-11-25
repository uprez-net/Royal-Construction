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
  offerAreaBasisFromJob,
  offerTotalBathrooms,
  offerTotalBedrooms,
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
import {
  buildAreaBreakdown,
  formatDwellingSpec,
  secondFloorSpec,
} from "@/lib/offer/workspace-print-template";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// A build can carry a second floor above the first, with its own bedrooms,
// bathrooms and floor area. While "Includes a Second Floor" is on, the area
// counts toward the printed total and prices like an upper floor, the rooms
// add to the totals the cost formulas read, and both documents list it. While
// it is off, whatever is stored does none of that.

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

const TWO_STOREY = {
  groundFloorSqm: 150,
  firstFloorSqm: 120,
  garageSqm: 40,
  bedrooms: 4,
  bathrooms: 2.5,
  garageSpaces: 2,
};

const WITHOUT = snapshotWithJob(TWO_STOREY);

const WITH = snapshotWithJob({
  ...TWO_STOREY,
  hasSecondFloor: true,
  secondFloorSqm: 80,
  secondFloorBedrooms: 2,
  secondFloorBathrooms: 1.5,
});

// The same figures stored, but the toggle turned back off.
const SWITCHED_OFF = snapshotWithJob({
  ...WITH.job,
  hasSecondFloor: false,
});

test("a new job starts with no second floor and zeroed counts", () => {
  assert.equal(INITIAL_OFFER_JOB.hasSecondFloor, false);
  assert.equal(INITIAL_OFFER_JOB.secondFloorSqm, 0);
  assert.equal(INITIAL_OFFER_JOB.secondFloorBedrooms, 0);
  assert.equal(INITIAL_OFFER_JOB.secondFloorBathrooms, 0);
});

test("second floor fields survive a persistence round-trip", () => {
  const restored = deserializeWorkspace(
    parseWorkspaceState(serializeWorkspace(WITH)),
  );

  assert.equal(restored.job.hasSecondFloor, true);
  assert.equal(restored.job.secondFloorSqm, 80);
  assert.equal(restored.job.secondFloorBedrooms, 2);
  assert.equal(restored.job.secondFloorBathrooms, 1.5);
});

test("an offer persisted before the second floor existed still parses", () => {
  const persisted = serializeWorkspace(WITHOUT);
  const job = persisted.job as Record<string, unknown>;
  delete job.hasSecondFloor;
  delete job.secondFloorSqm;
  delete job.secondFloorBedrooms;
  delete job.secondFloorBathrooms;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.job.hasSecondFloor, false);
  assert.equal(restored.job.secondFloorSqm, 0);
});

test("the second floor area joins the total only while the toggle is on", () => {
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(WITHOUT.job)), 310);
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(WITH.job)), 390);
  assert.equal(rawTotalAreaSqm(offerAreaBasisFromJob(SWITCHED_OFF.job)), 310);
});

test("the area grid carries a Second Floor cell that adds up to the total", () => {
  const breakdown = buildAreaBreakdown(WITH.job);
  const cell = breakdown.cells.find((entry) => entry.label === "Second Floor");

  assert.equal(cell?.sqm, 80);
  assert.equal(
    breakdown.cells.reduce((sum, entry) => sum + entry.sqm, 0),
    breakdown.totalSqm,
  );
  assert.equal(
    buildAreaBreakdown(SWITCHED_OFF.job).cells.some(
      (entry) => entry.label === "Second Floor",
    ),
    false,
  );
});

test("the second floor is framed at the upper-floor rate under both rules", () => {
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
      without.totalFirstFloorArea + 80,
    );
    assert.equal(withFloor.totalGroundFloorArea, without.totalGroundFloorArea);
  }
});

test("second floor rooms add to the totals only while the toggle is on", () => {
  assert.equal(offerTotalBedrooms(WITH.job), 6);
  assert.equal(offerTotalBathrooms(WITH.job), 4);
  assert.equal(offerTotalBedrooms(SWITCHED_OFF.job), 4);
  assert.equal(offerTotalBathrooms(SWITCHED_OFF.job), 2.5);
});

test("the cost formulas read the second floor's area, flooring and bedrooms", () => {
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

  assert.deepEqual(price(WITHOUT.job), [310, 120, 4]);
  assert.deepEqual(price(WITH.job), [390, 200, 6]);
  assert.deepEqual(price(SWITCHED_OFF.job), [310, 120, 4]);
});

test("secondFloorSpec is null unless the build has a second floor", () => {
  assert.equal(secondFloorSpec(WITHOUT.job), null);
  assert.equal(secondFloorSpec(SWITCHED_OFF.job), null);
  assert.deepEqual(secondFloorSpec(WITH.job), {
    bathrooms: 1.5,
    bedrooms: 2,
  });
});

test("a second floor spec prints no garage spaces", () => {
  assert.equal(
    formatDwellingSpec({ bedrooms: 2, bathrooms: 1.5 }),
    "2 bedrooms | 1.5 bathrooms",
  );
});

test("the proposal lists the second floor only when the build has one", () => {
  const withHtml = buildProposalHtml(buildProposalInput(WITH), WITH.images);
  assert.match(withHtml, /Second Floor Specifications/);
  assert.match(withHtml, /Second Floor<\/div>/);

  for (const snapshot of [WITHOUT, SWITCHED_OFF]) {
    const html = buildProposalHtml(
      buildProposalInput(snapshot),
      snapshot.images,
    );
    assert.doesNotMatch(html, /Second Floor/);
  }
});

test("the tender's Project Particulars carries the second floor", () => {
  const html = buildTenderHtml(buildProposalInput(WITH));

  assert.match(html, /Second Floor Specifications/);
  assert.match(html, /2 bedrooms \| 1\.5 bathrooms</);
  assert.doesNotMatch(
    buildTenderHtml(buildProposalInput(SWITCHED_OFF)),
    /Second Floor/,
  );
});
