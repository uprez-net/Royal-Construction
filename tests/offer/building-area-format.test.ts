import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JobSetupPanel } from "../../components/offers/new-workflow/offer-workspace-job";
import { OfferSummaryStrip } from "../../components/offers/new-workflow/shell/offer-summary-strip";
import { CURRENT_CALC_VERSION } from "../../lib/offer/calc-version";
import { INITIAL_OFFER_JOB } from "../../lib/offer/workspace-model";
import {
  formatArea,
  formatBuildingArea,
  formatSquares,
} from "../../lib/offer/workspace-print-template";
import {
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
} from "../../lib/offer/workspace-pricing";

// Australian building squares: 1 square = 100 sq ft = 9.290304 m².
// Estimators quote the rounded 9.29; the formatter uses the exact figure so
// the workspace total matches the printed cover.

test("one square is 9.290304 square metres", () => {
  assert.equal(formatSquares(9.290304), "1");
  assert.equal(formatArea(9.290304), "9.29 m²");
});

test("total building area shows square metres and squares", () => {
  // 232 / 9.290304 = 24.9726… → 24.97 sq
  assert.equal(formatBuildingArea(232), "232 m² (24.97 sq)");
});

test("a 10-square home formats without trailing zeroes", () => {
  assert.equal(formatBuildingArea(92.90304), "92.9 m² (10 sq)");
});

test("the job-setup total shows both square metres and squares", () => {
  const html = renderToStaticMarkup(
    createElement(JobSetupPanel, {
      calcVersion: CURRENT_CALC_VERSION,
      job: { ...INITIAL_OFFER_JOB, groundFloorSqm: 232 },
      onJobChange() {},
    }),
  );

  assert.ok(html.includes("Total building area"));
  assert.ok(html.includes("232 m²"));
  assert.ok(html.includes("24.97 sq"));
});

test("the summary strip building area shows both units", () => {
  const pricing = calculateOfferWorkspacePricing({
    directTotal: 100000,
    totalAreaSqm: 232,
    settings: {
      royalConstructionOverheadPct: 0.1,
      royalConstructionFeePct: 0.1,
      gstRate: 0.1,
      hbcfTotalContractValue: 0,
      hbcfRate: 0,
      homeWarrantyHbcfFixed: 0,
      impactFeeFixed: 0,
      loadingChargePercentage: 0,
    },
  });
  const html = renderToStaticMarkup(
    createElement(OfferSummaryStrip, {
      awaitingOffer: false,
      customerPrice: calculateOfferCustomerPrice({
        computedContractValueIncGst: pricing.contractValueIncGst,
        selectedContractValueIncGst: null,
        overrideReason: "",
      }),
      effectiveMargin: { effectiveMarkupPct: 0.2, marginStatus: "at_target" },
      pricing,
      totalAreaSqm: 232,
    }),
  );

  assert.ok(html.includes("232 m² (24.97 sq)"));
});
