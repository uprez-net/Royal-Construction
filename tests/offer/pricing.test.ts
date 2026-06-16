import assert from "node:assert/strict";
import {
  calculateOfferLinePricing,
  calculateOfferTotals,
  hydratePricingFromStoredTotal,
} from "../../lib/offer/pricing";

const gstExclusive = calculateOfferLinePricing({
  unitPrice: 100,
  quantity: 2,
  gstIncluded: false,
});

assert.deepEqual(gstExclusive, {
  netLine: 200,
  gstAmount: 20,
  totalPrice: 220,
});

const gstInclusive = calculateOfferLinePricing({
  unitPrice: 110,
  quantity: 1,
  gstIncluded: true,
});

assert.deepEqual(gstInclusive, {
  netLine: 100,
  gstAmount: 10,
  totalPrice: 110,
});

assert.deepEqual(hydratePricingFromStoredTotal(110), {
  netLine: 100,
  gstAmount: 10,
  totalPrice: 110,
});

assert.deepEqual(calculateOfferTotals([gstExclusive, gstInclusive]), {
  amount: 300,
  gstAmount: 30,
  totalAmount: 330,
});

