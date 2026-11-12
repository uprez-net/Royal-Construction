import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { OfferWorkspacePrintTemplate } from "@/components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
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
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// The Tender and the emailed offer printed each stage's share with
// toFixed(0), so a 12.5% stage read "13%" — two of them read 26% of a price
// they were really 25% of, beside amounts computed from the true 12.5%. The
// React print path already used formatPercent and printed "12.5%", so the
// three copies of one offer disagreed.

function snapshotWith(
  paymentSchedule: readonly OfferPaymentScheduleRow[],
): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
    calcVersion: LEGACY_CALC_VERSION,
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
  };
}

// Foundation split into two 12.5% stages; still sums to 100%.
const HALF_PERCENT_SCHEDULE: readonly OfferPaymentScheduleRow[] = [
  {
    id: "p1",
    stageName: "Deposit",
    percentOfContract: 0.05,
    trigger: "On signing",
  },
  {
    id: "p2",
    stageName: "Base",
    percentOfContract: 0.125,
    trigger: "Slab poured",
  },
  {
    id: "p3",
    stageName: "Slab",
    percentOfContract: 0.125,
    trigger: "Slab cured",
  },
  {
    id: "p4",
    stageName: "Frame",
    percentOfContract: 0.25,
    trigger: "Frame inspected",
  },
  {
    id: "p5",
    stageName: "Lock-up",
    percentOfContract: 0.25,
    trigger: "Lock-up",
  },
  { id: "p6", stageName: "Handover", percentOfContract: 0.2, trigger: "Keys" },
];

function tender(schedule: readonly OfferPaymentScheduleRow[]): string {
  return buildTenderHtml(buildProposalInput(snapshotWith(schedule)));
}

function emailed(schedule: readonly OfferPaymentScheduleRow[]): string {
  return buildProposalHtml(
    buildProposalInput(snapshotWith(schedule)),
    EMPTY_OFFER_IMAGES,
  );
}

function printed(schedule: readonly OfferPaymentScheduleRow[]): string {
  return renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...buildProposalInput(snapshotWith(schedule)),
      images: EMPTY_OFFER_IMAGES,
    }),
  );
}

test("the Tender prints a half-percent stage exactly", () => {
  const html = tender(HALF_PERCENT_SCHEDULE);
  assert.equal(html.split(">12.5%<").length - 1, 2);
  assert.equal(html.includes("13%"), false, "a 12.5% stage printed as 13%");
});

test("the emailed offer prints a half-percent stage exactly", () => {
  const html = emailed(HALF_PERCENT_SCHEDULE);
  assert.equal(html.split("12.5% - ").length - 1, 2);
  assert.equal(html.includes("13%"), false, "a 12.5% stage printed as 13%");
});

test("the printed offer agrees with the other two", () => {
  const html = printed(HALF_PERCENT_SCHEDULE);
  assert.ok(html.includes("12.5%"));
  assert.equal(html.includes("13%"), false);
});

test("a whole-number schedule prints as it always did", () => {
  assert.ok(
    tender(INITIAL_PAYMENT_SCHEDULE).includes('<td class="c-pay-pct">5%</td>'),
  );
  assert.ok(
    emailed(INITIAL_PAYMENT_SCHEDULE).includes('<td class="amt">5% - '),
  );
});
