import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INITIAL_PAYMENT_SCHEDULE,
  getPaymentScheduleTotalPct,
  type OfferPaymentScheduleRow,
} from "../../lib/offer/workspace-payment-schedule";

function scheduleFromPercents(
  percents: readonly number[],
): readonly OfferPaymentScheduleRow[] {
  return percents.map((percentOfContract, index) => ({
    id: `row-${index}`,
    stageName: `Stage ${index}`,
    percentOfContract,
    trigger: "",
  }));
}

test("the default schedule totals exactly 100% (float drift absorbed by rounding)", () => {
  // Raw float sum is 0.9999999999999999; the helper must round it to exactly 1.
  assert.equal(getPaymentScheduleTotalPct(INITIAL_PAYMENT_SCHEDULE), 1);
});

test("an under-allocated schedule does not read as balanced", () => {
  // Handover 10% -> 5%: sums to 95%.
  const total = getPaymentScheduleTotalPct(
    scheduleFromPercents([0.05, 0.15, 0.25, 0.25, 0.2, 0.05]),
  );
  assert.equal(total, 0.95);
  assert.notEqual(total, 1);
});

test("an over-allocated schedule does not read as balanced", () => {
  // Frame 25% -> 35%: sums to 110%.
  const total = getPaymentScheduleTotalPct(
    scheduleFromPercents([0.05, 0.15, 0.35, 0.25, 0.2, 0.1]),
  );
  assert.equal(total, 1.1);
  assert.notEqual(total, 1);
});

test("the balance check (=== 1) is exact for balanced non-default schedules", () => {
  assert.equal(
    getPaymentScheduleTotalPct(scheduleFromPercents([0.1, 0.2, 0.3, 0.4])) === 1,
    true,
  );
  assert.equal(
    getPaymentScheduleTotalPct(scheduleFromPercents([0.1, 0.2, 0.3])) === 1,
    false,
  );
});
