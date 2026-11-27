import assert from "node:assert/strict";
import { test } from "vitest";

import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// "Above tender is subject to final engineering details and council
// requirements." used to print on every Tender. It now prints only when the
// office ticks "Subject to site prices" on the Tender step, and a snapshot saved
// before the checkbox existed reads back unticked.

const NOTE =
  "Above tender is subject to final engineering details and council requirements.";

function snapshotWith(subjectToSitePrices: boolean): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: { ...INITIAL_TENDER_GATE, subjectToSitePrices },
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
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

function tenderWith(subjectToSitePrices: boolean): string {
  return buildTenderHtml(buildProposalInput(snapshotWith(subjectToSitePrices)));
}

test("the engineering and council note prints only when ticked", () => {
  assert.ok(tenderWith(true).includes(NOTE));
  assert.ok(!tenderWith(false).includes(NOTE));
  assert.ok(!tenderWith(false).includes("council requirements"));
});

test("a tender gate saved before the checkbox reads back unticked", () => {
  const stored = JSON.parse(
    JSON.stringify(serializeWorkspace(snapshotWith(true))),
  );
  delete stored.tenderGate.subjectToSitePrices;
  assert.equal(
    parseWorkspaceState(stored).tenderGate.subjectToSitePrices,
    false,
  );
});
