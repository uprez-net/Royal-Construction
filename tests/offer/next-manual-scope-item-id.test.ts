import assert from "node:assert/strict";
import { test } from "vitest";

import { nextManualScopeItemId } from "@/lib/offer/workspace-model";

// The Scope step counted new items from zero every time it opened, so the first
// exclusion added after reopening an offer reused `exclusion-manual-1` and
// editing or deleting one changed both.

test("the first item in an empty list is 1", () => {
  assert.equal(nextManualScopeItemId("exclusion", []), "exclusion-manual-1");
});

test("a reopened offer continues after its saved manual items", () => {
  const saved = [
    { id: "admin-exclusion-1-pool" },
    { id: "exclusion-manual-1" },
    { id: "exclusion-manual-4" },
  ];
  assert.equal(nextManualScopeItemId("exclusion", saved), "exclusion-manual-5");
});

test("allowances and exclusions count separately, and other ids are ignored", () => {
  const items = [
    { id: "allowance-manual-2" },
    { id: "exclusion-manual-x" },
    { id: "exclusion-3" },
  ];
  assert.equal(nextManualScopeItemId("allowance", items), "allowance-manual-3");
  assert.equal(nextManualScopeItemId("exclusion", items), "exclusion-manual-1");
});
