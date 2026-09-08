import assert from "node:assert/strict";
import { test } from "node:test";

import { hbfcClaimDataSchema } from "../../lib/validations/admin-offer-content";

// saveHBFCClaimAction was the only one of the five admin saves with no schema
// check. claimAmount is read as the whole-book HBCF sum assured, so an emptied
// field committing NaN wrote a value that reads back as zero and reported
// success. The schema existed and was imported nowhere on the write path.

test("the HBCF schema rejects NaN, which is what an emptied field commits", () => {
  const result = hbfcClaimDataSchema.safeParse({
    claimAmount: Number.NaN,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 0,
  });
  assert.equal(result.success, false);
});

test("the HBCF schema rejects a non-finite amount", () => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = hbfcClaimDataSchema.safeParse({
      claimAmount: value,
      loadingChargePercent: 0,
      totalPremiumToBePaid: 0,
    });
    assert.equal(result.success, false, `accepted ${value}`);
  }
});

test("the HBCF schema still accepts a real claim", () => {
  const result = hbfcClaimDataSchema.safeParse({
    claimAmount: 800_000,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 1_234.56,
  });
  assert.equal(result.success, true);
});
