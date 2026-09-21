import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  hbcfClaimDataSchema,
  offerScopeDataSchema,
  offerScopeWriteSchema,
} from "../../lib/validations/admin-offer-content";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function allowanceScope(variationRule: string) {
  return {
    allowances: [
      {
        id: "alw-1",
        name: "Ground floor ceiling upgrade",
        category: "package" as const,
        amount: 4500,
        variationRule,
      },
    ],
    exclusions: [],
  };
}

// saveHBCFClaimAction was the only one of the five admin saves with no schema
// check. claimAmount is read as the whole-book HBCF sum assured, so an emptied
// field committing NaN wrote a value that reads back as zero and reported
// success. The schema existed and was imported nowhere on the write path.

test("the HBCF schema rejects NaN, which is what an emptied field commits", () => {
  const result = hbcfClaimDataSchema.safeParse({
    claimAmount: Number.NaN,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 0,
  });
  assert.equal(result.success, false);
});

test("the HBCF schema rejects a non-finite amount", () => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = hbcfClaimDataSchema.safeParse({
      claimAmount: value,
      loadingChargePercent: 0,
      totalPremiumToBePaid: 0,
    });
    assert.equal(result.success, false, `accepted ${value}`);
  }
});

test("the HBCF schema still accepts a real claim", () => {
  const result = hbcfClaimDataSchema.safeParse({
    claimAmount: 800_000,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 1_234.56,
  });
  assert.equal(result.success, true);
});

test("the HBCF schema rejects negative values", () => {
  for (const field of ["claimAmount", "loadingChargePercent"] as const) {
    const result = hbcfClaimDataSchema.safeParse({
      claimAmount: 800_000,
      loadingChargePercent: 30,
      totalPremiumToBePaid: 0,
      [field]: -1,
    });
    assert.equal(result.success, false, `accepted a negative ${field}`);
  }
});

test("the HBCF schema accepts zero", () => {
  const result = hbcfClaimDataSchema.safeParse({
    claimAmount: 0,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 0,
  });
  assert.equal(result.success, true);
});

// The live admin row on prod and staging stored a blank variation rule on
// "Ground floor ceiling upgrade" (#266). The read schema must still accept
// that shape: coerceOfferScope uses it, and a failed parse would drop the
// invalid row instead of showing the blank. The write schema is what stops
// a blank rule being saved again.

test("the read schema still accepts an allowance with a blank variation rule", () => {
  const result = offerScopeDataSchema.safeParse(allowanceScope(""));
  assert.equal(result.success, true);
});

test("the write schema rejects an allowance with a blank variation rule", () => {
  for (const rule of ["", "   "]) {
    const result = offerScopeWriteSchema.safeParse(allowanceScope(rule));
    assert.equal(result.success, false, `accepted ${JSON.stringify(rule)}`);
  }
});

test("the write schema accepts an allowance with a real variation rule", () => {
  const result = offerScopeWriteSchema.safeParse(
    allowanceScope(
      "Work above this allowance is priced as a written variation.",
    ),
  );
  assert.equal(result.success, true);
});

test("saving offer scope uses the write schema", () => {
  const source = read("lib/actions/admin-offer-content.ts");
  const fn = source.slice(
    source.indexOf("export async function saveOfferScopeAction"),
    source.indexOf("export async function saveOfferContentAction"),
  );
  assert.match(fn, /offerScopeWriteSchema/);
  assert.match(fn, /updateOfferScope\(parsed\.data\)/);
  assert.equal(fn.includes("offerScopeDataSchema"), false);
});
