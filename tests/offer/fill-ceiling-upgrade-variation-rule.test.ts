import assert from "node:assert/strict";
import { test } from "node:test";

import type { OfferScopeData } from "../../types/admin-offer-content";
import {
  CEILING_UPGRADE_VARIATION_RULE,
  GROUND_FLOOR_CEILING_UPGRADE_NAME,
  fillCeilingUpgradeVariationRule,
} from "../../lib/offer/fill-ceiling-upgrade-variation-rule";

function scope(allowances: OfferScopeData["allowances"]): OfferScopeData {
  return { allowances, exclusions: [] };
}

const kitchen = {
  id: "kitchen",
  name: "Kitchen appliances",
  category: "package" as const,
  amount: 8500,
  variationRule: "Selections above allowance become a variation.",
};

const blankCeiling = {
  id: "ceiling",
  name: GROUND_FLOOR_CEILING_UPGRADE_NAME,
  category: "package" as const,
  amount: 4500,
  variationRule: "",
};

test("fills the blank Ground floor ceiling upgrade rule and leaves other rows alone", () => {
  const result = fillCeilingUpgradeVariationRule(
    scope([kitchen, blankCeiling]),
  );

  assert.equal(result.found, true);
  assert.equal(result.filled, true);
  assert.equal(result.next.allowances[0], kitchen);
  assert.equal(
    result.next.allowances[1]?.variationRule,
    CEILING_UPGRADE_VARIATION_RULE,
  );
  assert.deepEqual(result.otherBlankAllowances, []);
});

test("does not overwrite a ceiling upgrade that already has a rule", () => {
  const alreadyFilled = {
    ...blankCeiling,
    variationRule: "Already priced as a written variation.",
  };
  const input = scope([alreadyFilled]);
  const result = fillCeilingUpgradeVariationRule(input);

  assert.equal(result.found, true);
  assert.equal(result.filled, false);
  assert.equal(result.next, input);
});

test("treats a whitespace-only rule as blank", () => {
  const result = fillCeilingUpgradeVariationRule(
    scope([{ ...blankCeiling, variationRule: "  " }]),
  );

  assert.equal(result.filled, true);
  assert.equal(
    result.next.allowances[0]?.variationRule,
    CEILING_UPGRADE_VARIATION_RULE,
  );
});

test("matches the allowance name without caring about case or padding", () => {
  const result = fillCeilingUpgradeVariationRule(
    scope([
      {
        ...blankCeiling,
        name: "  GROUND FLOOR CEILING UPGRADE  ",
      },
    ]),
  );

  assert.equal(result.found, true);
  assert.equal(result.filled, true);
});

test("reports other blank allowances without filling them", () => {
  const blankTiles = {
    id: "tiles",
    name: "Tiles and bathroom fixtures",
    category: "per-sqm" as const,
    amount: 70,
    variationRule: "",
  };
  const result = fillCeilingUpgradeVariationRule(
    scope([blankCeiling, blankTiles]),
  );

  assert.equal(result.filled, true);
  assert.equal(result.next.allowances[1], blankTiles);
  assert.deepEqual(result.otherBlankAllowances, [blankTiles.name]);
});

test("says so when the named allowance is not in the list", () => {
  const input = scope([kitchen]);
  const result = fillCeilingUpgradeVariationRule(input);

  assert.equal(result.found, false);
  assert.equal(result.filled, false);
  assert.equal(result.next, input);
});
