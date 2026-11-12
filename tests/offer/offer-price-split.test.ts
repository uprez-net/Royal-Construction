import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveOfferPriceSplit } from "@/lib/offer/offer-contract-value";
import {
  INITIAL_TENDER_GATE,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import {
  calculateOfferWorkspacePricing,
  splitContractValueByGst,
} from "@/lib/offer/workspace-pricing";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceCostLine,
} from "@/lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import { buildOfferPrintTemplateData } from "@/lib/offer/workspace-print-template";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// Backs the Offers list's Amount / GST / Total columns. Offer.amount,
// Offer.gstAmount and Offer.totalAmount were minted at zero and never written
// again, so the list read $0.00 on every offer — live, sent and signed alike —
// while the document the client received quoted a real price.

const DIRECT_TOTAL = 400000;
const COST_LINE: OfferWorkspaceCostLine = {
  id: "line-1",
  stageCode: "A",
  itemName: "Base build",
  buildingSequenceTasks: [],
  offerTenderLineItem: "",
  tradeOrVendor: "",
  notesOrSpec: "",
  costExGst: DIRECT_TOTAL,
  includedInContract: true,
};

const COMPUTED = calculateOfferWorkspacePricing({
  directTotal: DIRECT_TOTAL,
  totalAreaSqm: 0,
  settings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
});

function makeSnapshot(
  overrides: Partial<OfferWorkspaceSnapshot> = {},
): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: [COST_LINE],
    allowances: [],
    exclusions: [],
    draft: INITIAL_OFFER_DRAFT,
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
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
    calcVersion: LEGACY_CALC_VERSION,
    ...overrides,
  };
}

// The row as Prisma hands it back: workspaceState is plain JSON, not a snapshot.
function storedState(snapshot: OfferWorkspaceSnapshot): unknown {
  return JSON.parse(JSON.stringify(serializeWorkspace(snapshot)));
}

test("the three columns reconcile exactly — amount + GST equals the total", () => {
  // Given a price whose ex-GST half does not divide to a whole cent
  const split = splitContractValueByGst({
    contractValueIncGst: 600000,
    gstRate: 0.1,
  });

  // Then the columns add up as printed. Rounding total x rate independently
  // would land a half-cent off and the Offers list would visibly not sum.
  assert.equal(split.amountExGst, 545454.55);
  assert.equal(split.gstAmount, 54545.45);
  assert.equal(split.totalIncGst, 600000);
  assert.equal(split.amountExGst + split.gstAmount, split.totalIncGst);
});

test("REGRESSION: the total is the figure the offer document prints", () => {
  // Given a workspace priced the normal way
  const snapshot = makeSnapshot();
  const printed = buildOfferPrintTemplateData(buildProposalInput(snapshot));

  // When the columns are derived for the Offers list
  const split = splitContractValueByGst({
    contractValueIncGst:
      buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst,
    gstRate: snapshot.workspacePricingSettings.gstRate,
  });

  // Then the list's Total is literally the figure in the document's headline
  // price line — the two surfaces cannot drift apart
  assert.equal(split.totalIncGst, COMPUTED.contractValueIncGst);
  assert.equal(
    printed.priceLine,
    `${new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(split.totalIncGst)} incl. GST`,
  );
});

test("GST is back-solved from the selected price, not read off the cost build-up", () => {
  // Given an estimator who overrode the contract value to $600k. The build-up
  // cannot see the override, so its own gstAmount belongs to the COMPUTED
  // price — using it would print a GST line the client's total contradicts.
  const snapshot = makeSnapshot({
    selectedPriceInput: "600000",
    overrideReason: "Client cap",
  });

  // When
  const split = splitContractValueByGst({
    contractValueIncGst:
      buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst,
    gstRate: snapshot.workspacePricingSettings.gstRate,
  });

  // Then GST is one eleventh of what was actually quoted
  assert.equal(split.totalIncGst, 600000);
  assert.equal(split.gstAmount, 54545.45);
  assert.notEqual(split.gstAmount, COMPUTED.gstAmount);
});

test("the revision's own saved GST rate is used, not a hardcoded ten percent", () => {
  // Given a revision saved under a different rate
  const split = splitContractValueByGst({
    contractValueIncGst: 500000,
    gstRate: 0.15,
  });

  // Then
  assert.equal(split.amountExGst, 434782.61);
  assert.equal(split.gstAmount, 65217.39);
  assert.equal(split.amountExGst + split.gstAmount, 500000);
});

test("REGRESSION: a row stored as $0 reports what the client was quoted", () => {
  // Given a revision saved before the columns were ever written
  const state = storedState(makeSnapshot());

  // When the Offers list resolves it
  const split = resolveOfferPriceSplit(0, state);

  // Then the derived triple, not three zeroes
  assert.ok(split !== null);
  assert.equal(split.totalIncGst, COMPUTED.contractValueIncGst);
  assert.equal(split.gstAmount, COMPUTED.gstAmount);
  assert.equal(split.amountExGst + split.gstAmount, split.totalIncGst);
});

test("a positive stored contract value stays authoritative", () => {
  // Given a sent revision whose snapshot would price differently today — the
  // list must keep showing the number the client received
  const state = storedState(makeSnapshot());

  // When
  const split = resolveOfferPriceSplit(880000, state);

  // Then
  assert.ok(split !== null);
  assert.equal(split.totalIncGst, 880000);
  assert.equal(split.amountExGst, 800000);
  assert.equal(split.gstAmount, 80000);
});

test("an unpriced revision resolves to null so stored columns are left alone", () => {
  // Given a brand-new revision with nothing saved against it
  // When
  const split = resolveOfferPriceSplit(null, null);

  // Then null rather than a confident $0 triple
  assert.equal(split, null);
});

test("a corrupted workspaceState falls back to the default GST rate", () => {
  // Given a stored price but a snapshot from a retired schema. The columns are
  // display-only; a parse failure must not take the Offers list down.
  const split = resolveOfferPriceSplit(1100000, { schemaVersion: -1 });

  // Then the split still resolves off the stored price at the default rate
  assert.ok(split !== null);
  assert.equal(split.totalIncGst, 1100000);
  assert.equal(split.amountExGst, 1000000);
  assert.equal(split.gstAmount, 100000);
});
