import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
  rawTotalAreaSqm,
  type OfferAreaBasis,
} from "@/lib/offer/workspace-area";
import { INITIAL_OFFER_JOB } from "@/lib/offer/workspace-model";

// The PR claimed the total-area refactor was "bit-identical over 200,000
// fractional cases", but the check was a throwaway script — an unreproducible
// claim about printed contract figures. This is that check, committed.
//
// rawTotalAreaSqm replaced three hand-copied sums: the print template's
// getTotalAreaSqm, the TOTAL_AREA formula variable, and the Job setup card.
// All three were token-identical, in this order.

const rnd = (n: number) => Math.round(n * 1000) / 1000;

// Transcribed verbatim from the expressions that existed before the refactor.
const oldPrintTemplateSum = (j: {
  groundFloorSqm: number;
  firstFloorSqm: number;
  garageSqm: number;
  alfrescoPorchSqm: number;
  porchSqm: number;
  grannyFlatSqm: number;
  balconySqm: number;
  voidSqm: number;
}) =>
  j.groundFloorSqm
  + j.firstFloorSqm
  + j.garageSqm
  + j.alfrescoPorchSqm
  + j.porchSqm
  + j.grannyFlatSqm
  + j.balconySqm
  + j.voidSqm;

const oldTotalAreaVariable = (b: OfferAreaBasis) =>
  b.groundFloorSqm
  + b.firstFloorSqm
  + b.garageSqm
  + b.alfrescoSqm
  + b.porchSqm
  + b.grannyFlatSqm
  + b.balconySqm
  + b.voidSqm;

function fractionalJob(i: number) {
  return {
    ...INITIAL_OFFER_JOB,
    groundFloorSqm: rnd(Math.sin(i * 1.1) * 250 + 250),
    firstFloorSqm: rnd(Math.sin(i * 2.3) * 200 + 200),
    garageSqm: rnd(Math.sin(i * 3.7) * 40 + 40),
    alfrescoPorchSqm: rnd(Math.sin(i * 5.1) * 30 + 30),
    porchSqm: rnd(Math.sin(i * 7.3) * 20 + 20),
    grannyFlatSqm: rnd(Math.sin(i * 11.9) * 60 + 60),
    balconySqm: rnd(Math.sin(i * 13.1) * 25 + 25),
    voidSqm: rnd(Math.sin(i * 17.3) * 20 + 20),
    kitchenSqm: rnd(Math.sin(i * 19.7) * 15 + 15),
  };
}

test("rawTotalAreaSqm is bit-identical to the three sums it replaced", () => {
  let mismatches = 0;
  for (let i = 0; i < 200_000; i++) {
    const job = fractionalJob(i);
    const basis = offerAreaBasisFromJob(job);
    const now = rawTotalAreaSqm(basis);
    // Object.is, not ===: floating-point addition is not associative, so an
    // identical term ORDER is the thing under test, not approximate equality.
    if (!Object.is(now, oldPrintTemplateSum(job))) mismatches++;
    if (!Object.is(now, oldTotalAreaVariable(basis))) mismatches++;
  }
  assert.equal(mismatches, 0);
});

test("the pricing sum is a DIFFERENT number, which is why they stayed separate", () => {
  // getAreaBasisTotalSqm rounds and sums in another order, and feeds the price.
  // Folding the two together would have moved printed areas on most jobs.
  let differs = 0;
  for (let i = 0; i < 200_000; i++) {
    const basis = offerAreaBasisFromJob(fractionalJob(i));
    if (!Object.is(rawTotalAreaSqm(basis), getAreaBasisTotalSqm(basis))) {
      differs++;
    }
  }
  assert.ok(
    differs > 100_000,
    `expected the two to diverge on most fractional jobs, saw ${differs}`,
  );
});
