import assert from "node:assert/strict";
import { test } from "vitest";

import {
  calculateOfferLinePricing,
  calculateOfferTotals,
  hydratePricingFromStoredTotal,
} from "@/lib/offer/pricing";

const gstExclusive = calculateOfferLinePricing({
  unitPrice: 100,
  quantity: 2,
  gstIncluded: false,
});

const gstInclusive = calculateOfferLinePricing({
  unitPrice: 110,
  quantity: 1,
  gstIncluded: true,
});

test("a GST-exclusive line adds GST on top of the net", () => {
  assert.deepEqual(gstExclusive, {
    netLine: 200,
    gstAmount: 20,
    totalPrice: 220,
  });
});

test("a GST-inclusive line has the GST taken back out of the total", () => {
  assert.deepEqual(gstInclusive, {
    netLine: 100,
    gstAmount: 10,
    totalPrice: 110,
  });
});

test("a stored total rehydrates into the same three figures", () => {
  assert.deepEqual(hydratePricingFromStoredTotal(110), {
    netLine: 100,
    gstAmount: 10,
    totalPrice: 110,
  });
});

test("offer totals sum the lines without double-counting GST", () => {
  assert.deepEqual(calculateOfferTotals([gstExclusive, gstInclusive]), {
    amount: 300,
    gstAmount: 30,
    totalAmount: 330,
  });
});
