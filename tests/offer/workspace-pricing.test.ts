import assert from "node:assert/strict";
import { test } from "vitest";

import {
  calculateAdditionsTotal,
  calculateRateCardComparison,
  calculateDirectTotal,
  calculateEffectiveMargin,
  calculateHbcfLoadingCharge,
  calculateHbcfPremium,
  calculateHbcfPremiumBreakdown,
  calculateStageSubtotals,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  getMarginStatus,
  parseNonNegativeNumberInput,
  resolveTargetMarkupPct,
  reverseHbcfTotalContractValue,
  withDerivedHbcfPremium,
  type OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";

// The Royal quote build-up: (direct + fixed additions)
//   × (1 + overhead + fee) × (1 + GST). Overhead + fee both apply to the base.
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

test("the quote build-up prices a 200sqm job end to end", () => {
  const pricing = calculateOfferWorkspacePricing({
    totalAreaSqm: 200,
    directTotal: 500000,
    settings: SETTINGS,
  });

  assert.deepEqual(pricing, {
    directTotal: 500000,
    additionsTotal: 0,
    costBeforeFee: 500000,
    royalConstructionOverhead: 50000, // 500000 × 10%
    royalConstructionFee: 50000, // 500000 × 10%
    totalIncludingConstruction: 600000, // additive: 10% + 10% = 20%
    gstAmount: 60000,
    contractValueIncGst: 660000,
    perSqm: 3300,
    gstRate: 0.1,
  });
});

test("the fee chain matches the real Royal workbooks", () => {
  // Verified against real Royal workbooks. These jobs carried the whole markup
  // on the single fee lever, so pin overhead to 0 to isolate it. 17 Ewing Loop:
  // direct 948,981 @ 20% → fee 189,796.20, total inc construction 1,138,777.20
  // — matches the workbook's own totals.
  const ewing = calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 948981,
    settings: {
      ...SETTINGS,
      royalConstructionOverheadPct: 0,
      royalConstructionFeePct: 0.2,
    },
  });
  assert.equal(ewing.royalConstructionFee, 189796.2);
  assert.equal(ewing.totalIncludingConstruction, 1138777.2);

  // 78 Cuttriss: direct 168.46sqm build-up cost 33,692 (slab) is a package, but
  // the fee chain holds for any direct — e.g. 557,950 @ 12% (13 Ferruccio).
  const ferruccio = calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 557950,
    settings: {
      ...SETTINGS,
      royalConstructionOverheadPct: 0,
      royalConstructionFeePct: 0.12,
    },
  });
  assert.equal(ferruccio.royalConstructionFee, 66954);
  assert.equal(ferruccio.totalIncludingConstruction, 624904);
});

test("the margin badge reads target, acceptable and below-minimum apart", () => {
  assert.equal(getMarginStatus(0.21, 0.2, 0.15), "at_target");
  assert.equal(getMarginStatus(0.151, 0.2, 0.15), "acceptable_below_target");
  assert.equal(getMarginStatus(0.12, 0.2, 0.15), "below_minimum");
});

// Effective margin reflects the ACTUAL selling price (incl. manual overrides),
// measured against the cost before fee. Floor is 0 (a loss reads red).
const marginSettings = {
  costBeforeFee: 118800,
  gstRate: 0.1,
  targetFeePct: 0.2,
};

test("no override measures the computed contract value against cost", () => {
  // selling = computed contract value (cost × 1.2 × 1.1) → at target.
  assert.deepEqual(
    calculateEffectiveMargin({
      ...marginSettings,
      sellingContractValueIncGst: 156816,
    }),
    { effectiveMarkupPct: 0.2, marginStatus: "at_target" },
  );
});

test("an override below cost reads as a loss, the case a flat badge misses", () => {
  assert.deepEqual(
    calculateEffectiveMargin({
      ...marginSettings,
      sellingContractValueIncGst: 120000,
    }),
    { effectiveMarkupPct: -0.0817, marginStatus: "below_minimum" },
  );
});

test("an override between cost and the target fee is acceptable_below_target", () => {
  // selling = cost × 1.17 × 1.1 = 118800 × 1.17 × 1.1 = 152895.6 → markup 0.17.
  assert.deepEqual(
    calculateEffectiveMargin({
      ...marginSettings,
      sellingContractValueIncGst: 152895.6,
    }),
    { effectiveMarkupPct: 0.17, marginStatus: "acceptable_below_target" },
  );
});

test("no cost yet is not_priced, never a red below_minimum badge", () => {
  // A fresh offer (and a priced one for the instant before it hydrates) has
  // costBeforeFee 0, which used to read as a 0% markup and paint a red "Below
  // minimum 0%" badge. An override-only price with no cost behind it has no
  // margin to judge either.
  assert.deepEqual(
    calculateEffectiveMargin({
      ...marginSettings,
      costBeforeFee: 0,
      sellingContractValueIncGst: 0,
    }),
    { effectiveMarkupPct: 0, marginStatus: "not_priced" },
  );
  assert.deepEqual(
    calculateEffectiveMargin({
      ...marginSettings,
      costBeforeFee: 0,
      sellingContractValueIncGst: 900000,
    }),
    { effectiveMarkupPct: 0, marginStatus: "not_priced" },
  );
});

test("the direct total counts only the lines included in the contract", () => {
  assert.equal(
    calculateDirectTotal([
      { costExGst: 100000, includedInContract: true },
      { costExGst: 25000, includedInContract: false },
      { costExGst: 12500.42, includedInContract: true },
    ]),
    112500.42,
  );
});

test("stage subtotals count every row but total only the included ones", () => {
  assert.deepEqual(
    calculateStageSubtotals([
      { stageCode: "A", costExGst: 12000, includedInContract: true },
      { stageCode: "A", costExGst: 3000, includedInContract: false },
      { stageCode: "C", costExGst: 40500, includedInContract: true },
    ]),
    [
      {
        stageCode: "A",
        stageName: "General Requirements",
        includedTotal: 12000,
        rowCount: 2,
        includedRowCount: 1,
      },
      {
        stageCode: "C",
        stageName: "Footings & Slab",
        includedTotal: 40500,
        rowCount: 1,
        includedRowCount: 1,
      },
    ],
  );
});

test("no floor area means no per-sqm rate, rather than a divide by zero", () => {
  assert.equal(
    calculateOfferWorkspacePricing({
      totalAreaSqm: 0,
      directTotal: 100000,
      settings: { ...SETTINGS },
    }).perSqm,
    null,
  );
});

test("a numeric field parses a blank to 0 and refuses anything unusable", () => {
  assert.equal(parseNonNegativeNumberInput("0"), 0);
  assert.equal(parseNonNegativeNumberInput("123.45"), 123.45);
  assert.equal(parseNonNegativeNumberInput(""), 0);
  assert.equal(parseNonNegativeNumberInput("-1"), null);
  assert.equal(parseNonNegativeNumberInput("not a number"), null);
  assert.equal(parseNonNegativeNumberInput("1e309"), null);
});

test("fixed additions sit inside the cost base, before the markup", () => {
  // The two surviving fixed additions (HBCF + impact fee): direct 405,560 +
  // (hbcf 8,500 + impact 1,500 = 10,000) = 415,560 cost before fee, × 16% fee =
  // 66,489.60.
  const withAdditions = calculateOfferWorkspacePricing({
    totalAreaSqm: 232,
    directTotal: 405560,
    settings: {
      ...SETTINGS,
      royalConstructionOverheadPct: 0,
      royalConstructionFeePct: 0.16,
      homeWarrantyHbcfFixed: 8500,
      impactFeeFixed: 1500,
    },
  });
  assert.equal(withAdditions.additionsTotal, 10000);
  assert.equal(withAdditions.costBeforeFee, 415560);
  assert.equal(withAdditions.royalConstructionFee, 66489.6);
});

test("calculateAdditionsTotal sums ONLY the two kept fixed fields", () => {
  assert.equal(
    calculateAdditionsTotal({
      ...SETTINGS,
      homeWarrantyHbcfFixed: 8500,
      impactFeeFixed: 1500,
    }),
    10000,
  );
});

test("overhead 10% + fee 10% applied additively equals a single 20% markup", () => {
  // The issue's "previously a single 20%" invariant, neutral vs the old fee.
  const split = calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 500000,
    settings: { ...SETTINGS },
  });
  assert.equal(split.royalConstructionOverhead, 50000);
  assert.equal(split.royalConstructionFee, 50000);
  assert.equal(split.totalIncludingConstruction, 600000);
});

test("the margin target is the COMBINED markup, never one lever", () => {
  assert.equal(
    resolveTargetMarkupPct({
      royalConstructionOverheadPct: 0.1,
      royalConstructionFeePct: 0.1,
    }),
    0.2,
  );
});

test("overhead and fee are each rounded to the cent, then summed", () => {
  // Rounding policy: so at a fractional-cent base the two lines total 1¢ more
  // than a single 20% would (498,672.07 vs 498,672.06). They still sum to TIC
  // exactly. Locked so a future "optimisation" to single-round the total is a
  // conscious change.
  const fractional = calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 415560.05,
    settings: { ...SETTINGS },
  });
  assert.equal(fractional.royalConstructionOverhead, 41556.01);
  assert.equal(fractional.royalConstructionFee, 41556.01);
  assert.equal(fractional.totalIncludingConstruction, 498672.07);
});

test("no override sells at the computed price with no reason required", () => {
  assert.deepEqual(
    calculateOfferCustomerPrice({
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: null,
      overrideReason: "",
    }),
    {
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: 834614,
      varianceIncGst: 0,
      hasManualOverride: false,
      needsOverrideReason: false,
    },
  );
});

test("a price below the rate-card floor is reported as below_floor", () => {
  assert.deepEqual(
    calculateRateCardComparison({
      product: "DOUBLE_STOREY",
      tier: "MID",
      totalAreaSqm: 407.71,
      selectedContractValueIncGst: 945000,
    }),
    {
      product: "DOUBLE_STOREY",
      productLabel: "Double storey",
      tier: "MID",
      tierLabel: "Mid",
      sellRatePerSqmIncGst: 2700,
      marginFloorRatePerSqmIncGst: 2376,
      targetContractValueIncGst: 1100817,
      floorContractValueIncGst: 968718.96,
      selectedContractValueIncGst: 945000,
      varianceToTargetIncGst: -155817,
      varianceToFloorIncGst: -23718.96,
      status: "below_floor",
    },
  );
});

test("a price between the floor and the target says so", () => {
  assert.equal(
    calculateRateCardComparison({
      product: "DOUBLE_STOREY",
      tier: "MID",
      totalAreaSqm: 407.71,
      selectedContractValueIncGst: 1000000,
    }).status,
    "between_floor_and_target",
  );
});

test("a price at or above the target says so", () => {
  assert.equal(
    calculateRateCardComparison({
      product: "DOUBLE_STOREY",
      tier: "MID",
      totalAreaSqm: 407.71,
      selectedContractValueIncGst: 1110000,
    }).status,
    "at_or_above_target",
  );
});

test("zero floor area does NOT read as a free at-target pass", () => {
  // Target/floor both collapse to $0, so surface a distinct no-area state.
  assert.equal(
    calculateRateCardComparison({
      product: "DOUBLE_STOREY",
      tier: "MID",
      totalAreaSqm: 0,
      selectedContractValueIncGst: 19800,
    }).status,
    "no_area",
  );
});

test("an unexplained override demands a reason", () => {
  assert.deepEqual(
    calculateOfferCustomerPrice({
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: 945000,
      overrideReason: "",
    }),
    {
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: 945000,
      varianceIncGst: 110386,
      hasManualOverride: true,
      needsOverrideReason: true,
    },
  );
});

test("an explained override is accepted as it stands", () => {
  assert.deepEqual(
    calculateOfferCustomerPrice({
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: 945000,
      overrideReason: "EOFY fixed price package approved by estimator.",
    }),
    {
      computedContractValueIncGst: 834614,
      selectedContractValueIncGst: 945000,
      varianceIncGst: 110386,
      hasManualOverride: true,
      needsOverrideReason: false,
    },
  );
});

test("the HBCF premium matches the official icare calculator", () => {
  // #116 — base = TCV × H01 metro rate, + GST 10%, + stamp 9% on base+GST.
  // Verified against portal.hbcf.nsw.gov.au for $650k and $500k.
  assert.equal(calculateHbcfPremium(650000, 0.00966), 7528.52);
  assert.equal(calculateHbcfPremium(500000, 0.00966), 5791.17);
  assert.equal(calculateHbcfPremium(0, 0.00966), 0);
  assert.equal(calculateHbcfPremium(-100, 0.00966), 0);
});

test("a TCV derives the premium onto the fixed HBCF addition", () => {
  assert.deepEqual(
    withDerivedHbcfPremium({
      ...SETTINGS,
      hbcfTotalContractValue: 650000,
      hbcfRate: 0.00966,
      homeWarrantyHbcfFixed: 0,
    }),
    {
      ...SETTINGS,
      hbcfTotalContractValue: 650000,
      hbcfRate: 0.00966,
      homeWarrantyHbcfFixed: 7528.52,
    },
  );
});

test("a blank TCV clears the premium, because TCV is the source of truth", () => {
  assert.deepEqual(
    withDerivedHbcfPremium({
      ...SETTINGS,
      hbcfTotalContractValue: 0,
      homeWarrantyHbcfFixed: 8500,
    }),
    {
      ...SETTINGS,
      hbcfTotalContractValue: 0,
      homeWarrantyHbcfFixed: 0,
    },
  );
});

test("the loading charge is a percentage of the whole grossed-up premium", () => {
  // Base + GST + stamp, added on top — not another markup on the cost base.
  assert.equal(calculateHbcfLoadingCharge(7528.52, 5), 376.43);
  assert.equal(calculateHbcfLoadingCharge(7528.52, 0), 0);
  // A blank/zero premium can't be loaded, so no NaN or phantom charge.
  assert.equal(calculateHbcfLoadingCharge(0, 5), 0);
});

test("the premium breakdown names every component the client is charged", () => {
  assert.deepEqual(calculateHbcfPremiumBreakdown(650000, 0.00966, 5), {
    basePremium: 6279,
    gstAmount: 627.9,
    stampDuty: 621.62,
    premiumBeforeLoading: 7528.52,
    loadingCharge: 376.43,
    totalPremium: 7904.95,
  });
});

test("zero loading leaves the icare figure untouched", () => {
  // Every legacy caller's path.
  assert.equal(
    calculateHbcfPremiumBreakdown(650000, 0.00966, 0).totalPremium,
    7528.52,
  );
  assert.equal(calculateHbcfPremium(650000, 0.00966, 5), 7904.95);
  assert.equal(calculateHbcfPremium(0, 0.00966, 5), 0);
});

test("the loaded total flows through additions into the customer price", () => {
  // withDerivedHbcfPremium carries it onto homeWarrantyHbcfFixed.
  assert.deepEqual(
    withDerivedHbcfPremium({
      ...SETTINGS,
      hbcfTotalContractValue: 650000,
      hbcfRate: 0.00966,
      loadingChargePercentage: 5,
      homeWarrantyHbcfFixed: 0,
    }),
    {
      ...SETTINGS,
      hbcfTotalContractValue: 650000,
      hbcfRate: 0.00966,
      loadingChargePercentage: 5,
      homeWarrantyHbcfFixed: 7904.95,
    },
  );
});

test("the loaded premium is a fixed addition, not another markup lever", () => {
  // It lands in additionsTotal, alongside the impact fee.
  const loadedAdditions = calculateAdditionsTotal({
    ...SETTINGS,
    homeWarrantyHbcfFixed: 7904.95,
    impactFeeFixed: 1500,
    loadingChargePercentage: 5,
  });
  assert.equal(loadedAdditions, 9404.95);
});

test("reversing a loaded premium divides the loading back out", () => {
  // Or hydrating a legacy offer and then touching any pricing field would load
  // it a second time.
  const reversedTcv = reverseHbcfTotalContractValue(7904.95, 0.00966, 5);
  assert.equal(Math.round(reversedTcv), 650000);
  // Cent-rounding in the forward gross-up means the reverse lands a cent shy of
  // the original TCV — the same tolerance the un-loaded path has always had.
  assert.equal(
    Math.round(reverseHbcfTotalContractValue(7528.52, 0.00966)),
    650000,
  );
});
