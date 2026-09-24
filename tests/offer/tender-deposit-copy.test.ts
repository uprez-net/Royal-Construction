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
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";

// The Tender's cover letter, its Tender Validity term and its acceptance
// instruction each said "5% deposit" as a literal, whatever deposit the offer's
// own payment schedule set. An offer taking a 10% deposit sent a Tender that
// asked for 5% three times, above a payment table that said 10%.

function tenderWith(
  paymentSchedule: readonly OfferPaymentScheduleRow[],
): string {
  const snapshot: OfferWorkspaceSnapshot = {
    job: INITIAL_OFFER_JOB,
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
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
  return buildTenderHtml(buildProposalInput(snapshot));
}

const occurrences = (html: string, needle: string) =>
  html.split(needle).length - 1;

test("the Tender asks for the deposit its own schedule sets", () => {
  const html = tenderWith(
    INITIAL_PAYMENT_SCHEDULE.map((row) =>
      row.stageName === "Deposit"
        ? { ...row, percentOfContract: 0.1 }
        : row.stageName === "Foundation"
          ? { ...row, percentOfContract: 0.1 }
          : row,
    ),
  );
  assert.equal(occurrences(html, "10% deposit"), 3);
  assert.equal(html.includes("5% deposit"), false);
});

test("the seeded 5% deposit still reads 5%", () => {
  assert.equal(
    occurrences(tenderWith(INITIAL_PAYMENT_SCHEDULE), "5% deposit"),
    3,
  );
});

test("the deposit is found by name, not position", () => {
  // Same rule the contract uses: a stage named for the deposit, else the first.
  const html = tenderWith([
    {
      id: "a",
      stageName: "Booking fee",
      percentOfContract: 0.02,
      trigger: "On signing",
    },
    {
      id: "b",
      stageName: "Initial Deposit",
      percentOfContract: 0.08,
      trigger: "Contract",
    },
    {
      id: "c",
      stageName: "Balance",
      percentOfContract: 0.9,
      trigger: "Handover",
    },
  ]);
  assert.equal(occurrences(html, "8% deposit"), 3);

  const unnamed = tenderWith([
    {
      id: "a",
      stageName: "Stage one",
      percentOfContract: 0.15,
      trigger: "On signing",
    },
    {
      id: "b",
      stageName: "Stage two",
      percentOfContract: 0.85,
      trigger: "Handover",
    },
  ]);
  assert.equal(occurrences(unnamed, "15% deposit"), 3);
});

test("a Tender with no payment stages promises no deposit", () => {
  assert.doesNotMatch(tenderWith([]), /deposit/i);
});
