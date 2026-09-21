import type { OfferScopeData } from "@/types/admin-offer-content";

export const GROUND_FLOOR_CEILING_UPGRADE_NAME = "Ground floor ceiling upgrade";

// Same shape as the seeded package allowances: how an overrun is charged,
// not a description of the work. Printed on the Tender against the item.
export const CEILING_UPGRADE_VARIATION_RULE =
  "Work above this allowance is priced as a written variation.";

export type FillCeilingUpgradeResult = {
  next: OfferScopeData;
  found: boolean;
  filled: boolean;
  otherBlankAllowances: string[];
};

function namesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isBlankRule(rule: string): boolean {
  return rule.trim().length === 0;
}

// Fills the blank variation rule on the named admin allowance. Other blank
// rules are reported, not invented. Those need a human, not a default.
export function fillCeilingUpgradeVariationRule(
  scope: OfferScopeData,
  rule: string = CEILING_UPGRADE_VARIATION_RULE,
): FillCeilingUpgradeResult {
  let found = false;
  let filled = false;
  const otherBlankAllowances: string[] = [];

  const allowances = scope.allowances.map((allowance) => {
    if (namesMatch(allowance.name, GROUND_FLOOR_CEILING_UPGRADE_NAME)) {
      found = true;
      if (!isBlankRule(allowance.variationRule)) {
        return allowance;
      }
      filled = true;
      return { ...allowance, variationRule: rule };
    }
    if (isBlankRule(allowance.variationRule) && allowance.name.trim()) {
      otherBlankAllowances.push(allowance.name);
    }
    return allowance;
  });

  return {
    next: filled ? { ...scope, allowances } : scope,
    found,
    filled,
    otherBlankAllowances,
  };
}
