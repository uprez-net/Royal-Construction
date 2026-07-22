import assert from "node:assert/strict";
import {
  calculateAdditionsTotal,
  calculateRateCardComparison,
  calculateDirectTotal,
  calculateEffectiveMargin,
  calculateStageSubtotals,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  getMarginStatus,
  parseNonNegativeNumberInput,
  resolveTargetMarkupPct,
  type OfferWorkspacePricingSettings,
} from "../../lib/offer/workspace-pricing";

// The Royal quote build-up: (direct + fixed additions)
//   × (1 + overhead + fee) × (1 + GST). Overhead + fee both apply to the base.
const SETTINGS: OfferWorkspacePricingSettings = {
  royalConstructionOverheadPct: 0.1,
  royalConstructionFeePct: 0.1,
  gstRate: 0.1,
  homeWarrantyHbcfFixed: 0,
  impactFeeFixed: 0,
};

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
});

// Verified against real Royal workbooks. These jobs carried the whole markup on
// the single fee lever, so pin overhead to 0 to isolate it. 17 Ewing Loop:
// direct 948,981 @ 20% → fee 189,796.20, total inc construction 1,138,777.20 —
// matches the workbook's own totals.
const ewing = calculateOfferWorkspacePricing({
  totalAreaSqm: 0,
  directTotal: 948981,
  settings: { ...SETTINGS, royalConstructionOverheadPct: 0, royalConstructionFeePct: 0.2 },
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

assert.equal(getMarginStatus(0.21, 0.2, 0.15), "at_target");
assert.equal(getMarginStatus(0.151, 0.2, 0.15), "acceptable_below_target");
assert.equal(getMarginStatus(0.12, 0.2, 0.15), "below_minimum");

// Effective margin reflects the ACTUAL selling price (incl. manual overrides),
// measured against the cost before fee. Floor is 0 (a loss reads red).
const marginSettings = {
  costBeforeFee: 118800,
  gstRate: 0.1,
  targetFeePct: 0.2,
};
// No override: selling = computed contract value (cost × 1.2 × 1.1) → at target.
assert.deepEqual(
  calculateEffectiveMargin({
    ...marginSettings,
    sellingContractValueIncGst: 156816,
  }),
  { effectiveMarkupPct: 0.2, marginStatus: "at_target" },
);
// Override BELOW cost → below_minimum (a loss; the case a flat badge misses).
assert.deepEqual(
  calculateEffectiveMargin({
    ...marginSettings,
    sellingContractValueIncGst: 120000,
  }),
  { effectiveMarkupPct: -0.0817, marginStatus: "below_minimum" },
);
// Override between cost and the target fee → acceptable_below_target.
// selling = cost × 1.17 × 1.1 = 118800 × 1.17 × 1.1 = 152895.6 → markup 0.17.
assert.deepEqual(
  calculateEffectiveMargin({
    ...marginSettings,
    sellingContractValueIncGst: 152895.6,
  }),
  { effectiveMarkupPct: 0.17, marginStatus: "acceptable_below_target" },
);

assert.equal(
  calculateDirectTotal([
    { costExGst: 100000, includedInContract: true },
    { costExGst: 25000, includedInContract: false },
    { costExGst: 12500.42, includedInContract: true },
  ]),
  112500.42,
);

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

assert.equal(
  calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 100000,
    settings: { ...SETTINGS },
  }).perSqm,
  null,
);

assert.equal(parseNonNegativeNumberInput("0"), 0);
assert.equal(parseNonNegativeNumberInput("123.45"), 123.45);
assert.equal(parseNonNegativeNumberInput(""), 0);
assert.equal(parseNonNegativeNumberInput("-1"), null);
assert.equal(parseNonNegativeNumberInput("not a number"), null);
assert.equal(parseNonNegativeNumberInput("1e309"), null);

// The two surviving fixed additions (HBCF + impact fee) sit inside the cost base
// before the markup: direct 405,560 + (hbcf 8,500 + impact 1,500 = 10,000) =
// 415,560 cost before fee, × 16% fee = 66,489.60.
const withAdditions = calculateOfferWorkspacePricing({
  totalAreaSqm: 232,
  directTotal: 405560,
  settings: {
    royalConstructionOverheadPct: 0,
    royalConstructionFeePct: 0.16,
    gstRate: 0.1,
    homeWarrantyHbcfFixed: 8500,
    impactFeeFixed: 1500,
  },
});
assert.equal(withAdditions.additionsTotal, 10000);
assert.equal(withAdditions.costBeforeFee, 415560);
assert.equal(withAdditions.royalConstructionFee, 66489.6);

// calculateAdditionsTotal now sums ONLY the two kept fixed fields.
assert.equal(
  calculateAdditionsTotal({
    royalConstructionOverheadPct: 0.1,
    royalConstructionFeePct: 0.1,
    gstRate: 0.1,
    homeWarrantyHbcfFixed: 8500,
    impactFeeFixed: 1500,
  }),
  10000,
);

// Overhead 10% + Fee 10% applied additively equals a single 20% markup — the
// issue's "previously a single 20%" invariant, neutral vs the old fee.
const split = calculateOfferWorkspacePricing({
  totalAreaSqm: 0,
  directTotal: 500000,
  settings: { ...SETTINGS },
});
assert.equal(split.royalConstructionOverhead, 50000);
assert.equal(split.royalConstructionFee, 50000);
assert.equal(split.totalIncludingConstruction, 600000);

// The margin badge's target is the COMBINED markup, never one lever.
assert.equal(
  resolveTargetMarkupPct({
    royalConstructionOverheadPct: 0.1,
    royalConstructionFeePct: 0.1,
  }),
  0.2,
);

// Rounding policy: overhead and fee are each rounded to the cent, then summed —
// so at a fractional-cent base the two lines total 1¢ more than a single 20%
// would (498,672.07 vs 498,672.06). They still sum to TIC exactly. Locked so a
// future "optimisation" to single-round the total is a conscious change.
const fractional = calculateOfferWorkspacePricing({
  totalAreaSqm: 0,
  directTotal: 415560.05,
  settings: { ...SETTINGS },
});
assert.equal(fractional.royalConstructionOverhead, 41556.01);
assert.equal(fractional.royalConstructionFee, 41556.01);
assert.equal(fractional.totalIncludingConstruction, 498672.07);

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

assert.equal(
  calculateRateCardComparison({
    product: "DOUBLE_STOREY",
    tier: "MID",
    totalAreaSqm: 407.71,
    selectedContractValueIncGst: 1000000,
  }).status,
  "between_floor_and_target",
);

assert.equal(
  calculateRateCardComparison({
    product: "DOUBLE_STOREY",
    tier: "MID",
    totalAreaSqm: 407.71,
    selectedContractValueIncGst: 1110000,
  }).status,
  "at_or_above_target",
);

// Zero floor area must NOT read as a free "at target" pass — target/floor both
// collapse to $0, so surface a distinct no-area state instead.
assert.equal(
  calculateRateCardComparison({
    product: "DOUBLE_STOREY",
    tier: "MID",
    totalAreaSqm: 0,
    selectedContractValueIncGst: 19800,
  }).status,
  "no_area",
);

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
