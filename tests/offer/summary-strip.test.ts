import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMoneyDelta } from "../../components/offers/new-workflow/offer-workspace-format";
import { buildOfferSummaryFigures } from "../../lib/offer/summary-strip";
import {
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  splitContractValueByGst,
  type OfferWorkspacePricingSettings,
} from "../../lib/offer/workspace-pricing";

// Pins the summary strip to the price going on the offer. The strip printed the
// cost build-up's GST and per-m² beside an overridden contract value, so a
// $900,000 offer showed the GST of a $950,000 one. It also compared whole
// dollars to decide whether the price was overridden, so a cents override
// blocked Send while the override chip stayed hidden.

const SETTINGS: OfferWorkspacePricingSettings = {
  royalConstructionOverheadPct: 0.1,
  royalConstructionFeePct: 0.1,
  gstRate: 0.1,
  hbcfTotalContractValue: 0,
  hbcfRate: 0.00966,
  homeWarrantyHbcfFixed: 0,
  impactFeeFixed: 0,
  loadingChargePercentage: 0,
};

const AREA_SQM = 250;

// Direct cost picked so the build-up lands on exactly $950,000 inc GST:
// 719,696.96 + 10% + 10% = 863,636.36, then + 10% GST = 950,000.
const PRICING = calculateOfferWorkspacePricing({
  directTotal: 719696.96,
  totalAreaSqm: AREA_SQM,
  settings: SETTINGS,
});

function priceAt(
  selected: number | null,
  computed: number = PRICING.contractValueIncGst,
) {
  return calculateOfferCustomerPrice({
    computedContractValueIncGst: computed,
    selectedContractValueIncGst: selected,
    overrideReason: "",
  });
}

function figuresAt(selected: number | null, computed?: number) {
  return buildOfferSummaryFigures({
    customerPrice: priceAt(selected, computed),
    pricing: PRICING,
    totalAreaSqm: AREA_SQM,
  });
}

test("the fixture build-up prices to $950,000 and carries its GST rate", () => {
  assert.equal(PRICING.contractValueIncGst, 950000);
  assert.equal(PRICING.gstRate, 0.1);
});

test("REGRESSION: the strip's GST belongs to the offer price, not the build-up", () => {
  // Given a $950,000 build-up overridden to $900,000
  const figures = figuresAt(900000);

  // Then GST is the $900,000 offer's own GST, which the build-up's line is not
  assert.equal(
    figures.gstOnOffer,
    splitContractValueByGst({ contractValueIncGst: 900000, gstRate: 0.1 })
      .gstAmount,
  );
  assert.notEqual(figures.gstOnOffer, PRICING.gstAmount);
});

test("with no override the offer's GST agrees with the build-up to the cent", () => {
  const figures = figuresAt(null);

  assert.ok(Math.abs(figures.gstOnOffer - PRICING.gstAmount) <= 0.01);
});

test("per m² divides the offer price, and is absent without an area", () => {
  assert.equal(figuresAt(900000).perSqm, 3600);
  assert.equal(PRICING.perSqm, 3800);
  assert.equal(
    buildOfferSummaryFigures({
      customerPrice: priceAt(900000),
      pricing: PRICING,
      totalAreaSqm: 0,
    }).perSqm,
    null,
  );
});

test("REGRESSION: a cents override raises the chip, because it blocks Send", () => {
  // Given a price 37 cents above the build-up. Both round to $950,000.
  const customerPrice = priceAt(950000, 949999.63);
  assert.equal(customerPrice.needsOverrideReason, true);

  // When
  const figures = buildOfferSummaryFigures({
    customerPrice,
    pricing: PRICING,
    totalAreaSqm: AREA_SQM,
  });

  // Then the strip agrees with the gate
  assert.equal(figures.overridden, true);
  assert.equal(figures.overrideDeltaIncGst, 0.37);
});

test("the override delta is signed: an offer under the build-up is negative", () => {
  const figures = figuresAt(900000);

  assert.equal(figures.overridden, true);
  assert.equal(figures.overrideDeltaIncGst, -50000);
});

test("no override means no chip and no delta", () => {
  const figures = figuresAt(null);

  assert.equal(figures.overridden, false);
  assert.equal(figures.overrideDeltaIncGst, 0);
});

test("a money delta keeps its sign, and its cents when under a dollar", () => {
  // A sub-dollar override still blocks Send, so it must not print as "$0".
  assert.equal(formatMoneyDelta(0.37), "+$0.37");
  assert.equal(formatMoneyDelta(-0.5), "-$0.50");
  assert.equal(formatMoneyDelta(-50000), "-$50,000");
  assert.equal(formatMoneyDelta(110386), "+$110,386");
  assert.equal(formatMoneyDelta(0), "$0");
});
