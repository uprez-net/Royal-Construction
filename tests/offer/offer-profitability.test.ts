import assert from "node:assert/strict";
import { test } from "vitest";

import {
  calculateEffectiveMargin,
  calculateOfferProfitability,
  calculateOfferWorkspacePricing,
  COMPANY_OVERHEAD_ALLOCATION,
} from "@/lib/offer/workspace-pricing";

// Issue #632's worked example: $650,000 job cost marked up 20% (12% overhead
// markup + 8% builder's fee), priced at the calculated build-up.
const JOB_COST = 650000;

test("the issue's illustrative quote reads the figures it promises", () => {
  const pricing = calculateOfferWorkspacePricing({
    directTotal: 642000,
    totalAreaSqm: 0,
    settings: {
      royalConstructionOverheadPct: 0.12,
      royalConstructionFeePct: 0.08,
      gstRate: 0.1,
      hbcfTotalContractValue: 0,
      hbcfRate: 0.00966,
      homeWarrantyHbcfFixed: 8000,
      impactFeeFixed: 0,
      loadingChargePercentage: 0,
    },
  });
  assert.equal(pricing.costBeforeFee, JOB_COST);
  assert.equal(pricing.totalIncludingConstruction, 780000);
  assert.equal(pricing.contractValueIncGst, 858000);

  const profit = calculateOfferProfitability({
    jobCost: pricing.costBeforeFee,
    sellingContractValueIncGst: pricing.contractValueIncGst,
    gstRate: pricing.gstRate,
    companyOverheadRate: 0.06,
  });
  assert.deepEqual(profit, {
    sellingPriceIncGst: 858000,
    sellingPriceExGst: 780000,
    gstAmount: 78000,
    jobCost: JOB_COST,
    effectiveMarkupPct: 0.2,
    grossProfit: 130000,
    grossMarginPct: 0.1667,
    companyOverheadRate: 0.06,
    companyOverhead: 46800,
    projectedProfitBeforeTax: 83200,
    projectedMarginBeforeTaxPct: 0.1067,
  });
});

test("a discount is measured at the selected price, not the build-up", () => {
  // $33,000 off inc GST → $750,000 ex GST.
  const profit = calculateOfferProfitability({
    jobCost: JOB_COST,
    sellingContractValueIncGst: 825000,
    gstRate: 0.1,
    companyOverheadRate: 0.06,
  });
  assert.equal(profit.sellingPriceExGst, 750000);
  assert.equal(profit.gstAmount, 75000);
  assert.equal(profit.grossProfit, 100000);
  assert.equal(profit.effectiveMarkupPct, 0.1538);
  assert.equal(profit.companyOverhead, 45000);
  assert.equal(profit.projectedProfitBeforeTax, 55000);
});

test("a below-cost offer shows a loss, not a clamped zero", () => {
  const profit = calculateOfferProfitability({
    jobCost: JOB_COST,
    sellingContractValueIncGst: 693000,
    gstRate: 0.1,
    companyOverheadRate: 0.06,
  });
  assert.equal(profit.sellingPriceExGst, 630000);
  assert.equal(profit.grossProfit, -20000);
  assert.ok((profit.grossMarginPct ?? 0) < 0);
  assert.equal(profit.projectedProfitBeforeTax, -57800);
  assert.ok((profit.projectedMarginBeforeTaxPct ?? 0) < 0);
});

test("an unpriced quote has no percentages to show", () => {
  for (const [jobCost, selling] of [
    [0, 0],
    [0, 900000],
    [JOB_COST, 0],
  ] as const) {
    const profit = calculateOfferProfitability({
      jobCost,
      sellingContractValueIncGst: selling,
      gstRate: 0.1,
    });
    assert.equal(profit.effectiveMarkupPct, null);
    assert.equal(profit.grossMarginPct, null);
    assert.equal(profit.projectedMarginBeforeTaxPct, null);
  }
});

test("the markup badge and the profitability panel agree on markup", () => {
  for (const selling of [858000, 825000, 693000, 857999.99]) {
    const badge = calculateEffectiveMargin({
      costBeforeFee: JOB_COST,
      sellingContractValueIncGst: selling,
      gstRate: 0.1,
      targetFeePct: 0.2,
    });
    const panel = calculateOfferProfitability({
      jobCost: JOB_COST,
      sellingContractValueIncGst: selling,
      gstRate: 0.1,
    });
    assert.equal(panel.effectiveMarkupPct, badge.effectiveMarkupPct);
  }
});

test("company overhead is its own rate, not the quote's overhead markup", () => {
  // Defaulted from the company allocation, which stays labelled illustrative
  // until the business approves a figure.
  const profit = calculateOfferProfitability({
    jobCost: JOB_COST,
    sellingContractValueIncGst: 858000,
    gstRate: 0.1,
  });
  assert.equal(profit.companyOverheadRate, COMPANY_OVERHEAD_ALLOCATION.rate);
  assert.equal(
    profit.companyOverhead,
    Math.round(780000 * COMPANY_OVERHEAD_ALLOCATION.rate * 100) / 100,
  );
});
