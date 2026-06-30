import assert from "node:assert/strict";
import {
  calculateDirectTotal,
  calculateLegacyWorkbookPricing,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  getMarginStatus,
  parseNonNegativeNumberInput,
} from "../../lib/offer/workspace-pricing";

const pricing = calculateOfferWorkspacePricing({
  totalAreaSqm: 200,
  directTotal: 500000,
  settings: {
    targetMarkupPct: 0.2,
    minimumMarkupPct: 0.15,
    gstRate: 0.1,
    hbcfRate: 0.013,
    adminCostFixed: 5000,
    projectManagementCostFixed: 10000,
    contingencyPct: 0.025,
  },
});

assert.deepEqual(pricing, {
  directTotal: 500000,
  hbcfInsurance: 6500,
  adminCost: 5000,
  projectManagementCost: 10000,
  contingency: 12500,
  costBase: 534000,
  builderMargin: 106800,
  subtotalExGst: 640800,
  gstAmount: 64080,
  contractValueIncGst: 704880,
  perSqm: 3524.4,
  appliedMarkupPct: 0.2,
  marginStatus: "at_target",
});

assert.equal(getMarginStatus(0.21, 0.2, 0.15), "at_target");
assert.equal(getMarginStatus(0.151, 0.2, 0.15), "acceptable_below_target");
assert.equal(getMarginStatus(0.12, 0.2, 0.15), "below_minimum");

assert.equal(
  calculateDirectTotal([
    { costExGst: 100000, includedInContract: true },
    { costExGst: 25000, includedInContract: false },
    { costExGst: 12500.42, includedInContract: true },
  ]),
  112500.42,
);

assert.equal(
  calculateOfferWorkspacePricing({
    totalAreaSqm: 0,
    directTotal: 100000,
    settings: {
      targetMarkupPct: 0.1,
      minimumMarkupPct: 0.15,
      gstRate: 0.1,
      hbcfRate: 0,
      adminCostFixed: 0,
      projectManagementCostFixed: 0,
      contingencyPct: 0,
    },
  }).perSqm,
  null,
);

assert.equal(
  calculateOfferWorkspacePricing({
    totalAreaSqm: 100,
    directTotal: 100000,
    settings: {
      targetMarkupPct: 0.1,
      minimumMarkupPct: 0.15,
      gstRate: 0.1,
      hbcfRate: 0,
      adminCostFixed: 0,
      projectManagementCostFixed: 0,
      contingencyPct: 0,
    },
  }).marginStatus,
  "below_minimum",
);

assert.equal(parseNonNegativeNumberInput("0"), 0);
assert.equal(parseNonNegativeNumberInput("123.45"), 123.45);
assert.equal(parseNonNegativeNumberInput(""), 0);
assert.equal(parseNonNegativeNumberInput("-1"), null);
assert.equal(parseNonNegativeNumberInput("not a number"), null);
assert.equal(parseNonNegativeNumberInput("1e309"), null);

assert.deepEqual(
  calculateLegacyWorkbookPricing({
    directTotal: 405560,
    settings: {
      overheadPct: 0,
      royalConstructionFeePct: 0.16,
      hbcfInsuranceFixed: 8500,
      adminCostFixed: 5000,
      labourCostFixed: 8000,
      otherAdjustmentFixed: 40000,
    },
    totalAreaSqm: 232,
  }),
  {
    directTotal: 405560,
    overhead: 0,
    royalConstructionFee: 64889.6,
    hbcfInsurance: 8500,
    adminCost: 5000,
    labourCost: 8000,
    otherAdjustment: 40000,
    totalIncludingConstructionCost: 531949.6,
    perSqm: 2292.89,
  },
);

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
