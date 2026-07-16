import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import {
  calculateOfferWorkspacePricing,
  resolveOptionalPriceInput,
} from "../../lib/offer/workspace-pricing";
import {
  DEFAULT_LEGACY_PRICING_SETTINGS,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceCostLine,
} from "../../lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";

// One included $400k direct-cost line → directTotal 400,000.
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

// The price the estimator sees on screen when they accept the computed value
// (no override). Floor areas are all 0 here, so totalAreaSqm = 0.
const COMPUTED_CONTRACT_INC_GST = calculateOfferWorkspacePricing({
  directTotal: DIRECT_TOTAL,
  totalAreaSqm: 0,
  settings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
}).contractValueIncGst;

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
    legacyPricingSettings: DEFAULT_LEGACY_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
    ...overrides,
  };
}

// Simulate the real persistence round-trip: serialize → JSON → validate → load.
function roundTrip(snapshot: OfferWorkspaceSnapshot): OfferWorkspaceSnapshot {
  const persisted = serializeWorkspace(snapshot);
  const reloaded = parseWorkspaceState(JSON.parse(JSON.stringify(persisted)));
  return deserializeWorkspace(reloaded);
}

// Sanity: the computed baseline is a real, positive number, not $0.
assert.equal(COMPUTED_CONTRACT_INC_GST, 567864);

test("blank selected price → proposal shows the computed contract price, not $0", () => {
  const input = buildProposalInput(makeSnapshot({ selectedPriceInput: "" }));
  assert.equal(
    input.customerPrice.selectedContractValueIncGst,
    COMPUTED_CONTRACT_INC_GST,
  );
  assert.equal(input.customerPrice.varianceIncGst, 0);
  assert.equal(input.customerPrice.hasManualOverride, false);
  assert.notEqual(input.customerPrice.selectedContractValueIncGst, 0);
});

test("REGRESSION: blank price survives serialize→load→proposal as computed price, never $0", () => {
  // The un-entered override round-trips through cents to the string "0"...
  const reloaded = roundTrip(makeSnapshot({ selectedPriceInput: "" }));
  assert.equal(reloaded.selectedPriceInput, "0");
  // ...but must still be read as "no override", so the customer-facing PDF /
  // Tender show the computed contract value — this is the $0-on-the-PDF bug.
  const input = buildProposalInput(reloaded);
  assert.equal(
    input.customerPrice.selectedContractValueIncGst,
    COMPUTED_CONTRACT_INC_GST,
  );
  assert.notEqual(input.customerPrice.selectedContractValueIncGst, 0);
  assert.equal(input.customerPrice.hasManualOverride, false);
});

test("blank standard price does not become a $0 standard price after round-trip", () => {
  const reloaded = roundTrip(makeSnapshot({ standardPriceInput: "" }));
  const input = buildProposalInput(reloaded);
  // null (no standard price), not 0 — a $0 would render a bogus saving line.
  assert.equal(input.standardPriceIncGst, null);
});

test("a real manual override is still honored through the round-trip", () => {
  const reloaded = roundTrip(
    makeSnapshot({ selectedPriceInput: "600000", overrideReason: "Client cap" }),
  );
  const input = buildProposalInput(reloaded);
  assert.equal(input.customerPrice.selectedContractValueIncGst, 600000);
  assert.equal(input.customerPrice.hasManualOverride, true);
  assert.equal(
    input.customerPrice.varianceIncGst,
    600000 - COMPUTED_CONTRACT_INC_GST,
  );
});

test("resolveOptionalPriceInput treats blank and $0 as 'no override'", () => {
  assert.equal(resolveOptionalPriceInput(""), null);
  assert.equal(resolveOptionalPriceInput("0"), null);
  assert.equal(resolveOptionalPriceInput("0.00"), null);
  assert.equal(resolveOptionalPriceInput("  "), null);
  assert.equal(resolveOptionalPriceInput("-5"), null);
  assert.equal(resolveOptionalPriceInput("abc"), null);
  assert.equal(resolveOptionalPriceInput("600000"), 600000);
  assert.equal(resolveOptionalPriceInput("19800"), 19800);
});

test("an unknown persisted rate-card product/tier coerces to the default entry", () => {
  const persisted = serializeWorkspace(makeSnapshot());
  const corrupted = JSON.parse(
    JSON.stringify({
      ...persisted,
      rateCardProduct: "TOWNHOUSE",
      rateCardTier: "DELUXE",
    }),
  );
  const reloaded = deserializeWorkspace(parseWorkspaceState(corrupted));
  // Coerced to the fallback entry (Double storey · Mid) so label and rate agree.
  assert.equal(reloaded.rateCardProduct, "DOUBLE_STOREY");
  assert.equal(reloaded.rateCardTier, "MID");
});

test("a valid persisted rate-card product/tier is preserved", () => {
  const reloaded = roundTrip(
    makeSnapshot({ rateCardProduct: "DUPLEX", rateCardTier: "PREMIUM" }),
  );
  assert.equal(reloaded.rateCardProduct, "DUPLEX");
  assert.equal(reloaded.rateCardTier, "PREMIUM");
});
