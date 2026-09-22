import assert from "node:assert/strict";
import { test } from "vitest";

import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
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
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import {
  formatDwellingSpec,
  grannyDwellingSpec,
} from "@/lib/offer/workspace-print-template";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";

// A dual-occupancy build carries a granny home with its own bed/bath/garage
// counts. Both the Offer proposal and the Tender must present the two dwellings
// as separate, labelled specifications — and must NOT print a granny section for
// a single-dwelling build.

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
    calcVersion: LEGACY_CALC_VERSION,
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

const MAJOR_ONLY = snapshotWithJob({
  bedrooms: 4,
  bathrooms: 2.5,
  garageSpaces: 2,
});

const WITH_GRANNY = snapshotWithJob({
  bedrooms: 4,
  bathrooms: 2.5,
  garageSpaces: 2,
  hasGrannyHome: true,
  grannyBedrooms: 2,
  grannyBathrooms: 1,
  grannyGarageSpaces: 1,
});

test("a new job starts with no granny home and zeroed granny counts", () => {
  assert.equal(INITIAL_OFFER_JOB.hasGrannyHome, false);
  assert.equal(INITIAL_OFFER_JOB.grannyBedrooms, 0);
  assert.equal(INITIAL_OFFER_JOB.grannyBathrooms, 0);
  assert.equal(INITIAL_OFFER_JOB.grannyGarageSpaces, 0);
});

test("granny fields survive a persistence round-trip", () => {
  const restored = deserializeWorkspace(
    parseWorkspaceState(serializeWorkspace(WITH_GRANNY)),
  );

  assert.equal(restored.job.hasGrannyHome, true);
  assert.equal(restored.job.grannyBedrooms, 2);
  assert.equal(restored.job.grannyBathrooms, 1);
  assert.equal(restored.job.grannyGarageSpaces, 1);
});

test("an offer persisted before the granny fields existed still parses", () => {
  const persisted = serializeWorkspace(MAJOR_ONLY);
  const job = persisted.job as Record<string, unknown>;
  delete job.hasGrannyHome;
  delete job.grannyBedrooms;
  delete job.grannyBathrooms;
  delete job.grannyGarageSpaces;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.job.hasGrannyHome, false);
  assert.equal(restored.job.grannyBedrooms, 0);
});

test("grannyDwellingSpec is null unless the build has a granny home", () => {
  assert.equal(grannyDwellingSpec(MAJOR_ONLY.job), null);
  assert.deepEqual(grannyDwellingSpec(WITH_GRANNY.job), {
    bathrooms: 1,
    bedrooms: 2,
    garageSpaces: 1,
  });
});

test("a half bathroom prints as entered, not rounded away", () => {
  const line = formatDwellingSpec({
    bathrooms: 2.5,
    bedrooms: 4,
    garageSpaces: 2,
  });

  assert.match(line, /2\.5 bathrooms/);
});

test("the proposal snapshot page labels the major house specifications", () => {
  const html = buildProposalHtml(
    buildProposalInput(MAJOR_ONLY),
    MAJOR_ONLY.images,
  );

  assert.match(html, /Major House Specifications/);
  assert.doesNotMatch(html, /Granny Home Specifications/);
});

test("the proposal adds a granny home section only for a dual-occupancy build", () => {
  const html = buildProposalHtml(
    buildProposalInput(WITH_GRANNY),
    WITH_GRANNY.images,
  );

  assert.match(html, /Major House Specifications/);
  assert.match(html, /Granny Home Specifications/);
});

test("the tender's Project Particulars carries both dwellings", () => {
  const html = buildTenderHtml(buildProposalInput(WITH_GRANNY));

  assert.match(html, /Major House Specifications/);
  assert.match(html, /Granny Home Specifications/);
  assert.match(html, /2 bedrooms \| 1 bathrooms \| 1 garage spaces/);
});

test("the tender omits the granny row for a single-dwelling build", () => {
  const html = buildTenderHtml(buildProposalInput(MAJOR_ONLY));

  assert.match(html, /Major House Specifications/);
  assert.doesNotMatch(html, /Granny Home Specifications/);
});
