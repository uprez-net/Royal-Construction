import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
} from "../../lib/data/admin-offer-content-coerce";

// Production stored a good claimAmount beside two nulls. coerceHBCFClaim used
// to safeParse the whole object and, on that failure, replace all three fields
// with 0 — so the HBCF pool read as empty and the admin page showed 0 / 0.
// Saving while it displayed zeros would then overwrite the stored 8,000,000.
// The same all-or-nothing fallback sat on the other admin sections.

test("a null sibling does not zero a valid HBCF claim amount", () => {
  // The production row from #271.
  assert.deepEqual(
    coerceHBCFClaim({
      claimAmount: 8_000_000,
      loadingChargePercent: null,
      totalPremiumToBePaid: null,
    }),
    {
      claimAmount: 8_000_000,
      loadingChargePercent: 0,
      totalPremiumToBePaid: 8_000_000,
    },
  );
});

test("a valid loading percent is kept when the premium is missing", () => {
  assert.deepEqual(
    coerceHBCFClaim({
      claimAmount: 8_000_000,
      loadingChargePercent: 30,
      totalPremiumToBePaid: null,
    }),
    {
      claimAmount: 8_000_000,
      loadingChargePercent: 30,
      totalPremiumToBePaid: 10_400_000,
    },
  );
});

test("a stored finite premium is kept even when a sibling is repaired", () => {
  assert.deepEqual(
    coerceHBCFClaim({
      claimAmount: 8_000_000,
      loadingChargePercent: null,
      totalPremiumToBePaid: 10_400_000,
    }),
    {
      claimAmount: 8_000_000,
      loadingChargePercent: 0,
      totalPremiumToBePaid: 10_400_000,
    },
  );
});

test("a negative claim amount is defaulted without discarding the loading percent", () => {
  assert.deepEqual(
    coerceHBCFClaim({
      claimAmount: -1,
      loadingChargePercent: 30,
      totalPremiumToBePaid: 0,
    }),
    {
      claimAmount: 0,
      loadingChargePercent: 30,
      totalPremiumToBePaid: 0,
    },
  );
});

test("a fully valid HBCF object is returned unchanged", () => {
  const value = {
    claimAmount: 2_000_000,
    loadingChargePercent: 30,
    totalPremiumToBePaid: 2_600_000,
  };
  assert.deepEqual(coerceHBCFClaim(value), value);
});

test("unreadable HBCF JSON still falls back to zeros", () => {
  for (const value of [null, "nope", 12, []]) {
    assert.deepEqual(
      coerceHBCFClaim(value),
      {
        claimAmount: 0,
        loadingChargePercent: 0,
        totalPremiumToBePaid: 0,
      },
      `did not default ${JSON.stringify(value)}`,
    );
  }
});

const goodRow = {
  id: "row-1",
  taskKey: "slab",
  phase: "SLAB",
  task: "Slab",
  defaultInclude: true,
  priceMode: "fixed" as const,
  value: 18_500,
};

test("one invalid cost-schedule row does not wipe the rest of the section", () => {
  const coerced = coerceCostSchedule({
    rows: [goodRow, { id: "row-2", priceMode: "fixed" }],
    rateConstants: { SLAB_COST_PER_SQM: 210, BROKEN: null },
  });
  assert.deepEqual(coerced.rows, [goodRow]);
  assert.deepEqual(coerced.rateConstants, { SLAB_COST_PER_SQM: 210 });
});

test("one invalid allowance does not wipe the rest of offer scope", () => {
  const allowance = {
    id: "a1",
    name: "Lighting",
    category: "package" as const,
    amount: 12_000,
    variationRule: "Charged as a variation.",
  };
  const exclusion = {
    id: "e1",
    name: "Landscaping",
    description: "Owner supplied",
    variationRule: "Excluded.",
    exclusionKind: "excluded" as const,
  };
  assert.deepEqual(
    coerceOfferScope({
      allowances: [allowance, { id: "a2", name: "Broken" }],
      exclusions: [exclusion],
    }),
    { allowances: [allowance], exclusions: [exclusion] },
  );
});

test("one invalid offer-content field does not reset the section", () => {
  const coerced = coerceOfferContent({
    headline: "Kept headline",
    introText: 12,
    inclusions: ["Brick veneer", 4],
    exclusions: ["Landscaping"],
    inclusionSchedule: [{ spec: "Kitchen" }, { spec: 9 }],
    termsAndConditions: "Kept terms",
  });
  assert.equal(coerced.headline, "Kept headline");
  assert.equal(coerced.termsAndConditions, "Kept terms");
  assert.deepEqual(coerced.inclusions, ["Brick veneer"]);
  assert.deepEqual(coerced.exclusions, ["Landscaping"]);
  assert.deepEqual(coerced.inclusionSchedule, [{ spec: "Kitchen" }]);
  assert.equal(typeof coerced.introText, "string");
  assert.notEqual(coerced.introText, "");
});
