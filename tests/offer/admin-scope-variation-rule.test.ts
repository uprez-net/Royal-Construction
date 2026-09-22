import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// #266: the admin editor let an allowance save with a blank variation rule,
// and that wording (or the lack of it) went onto every new offer and signed
// Tender. The field is required on the allowance row; exclusions are not
// the same contractual leak.

test("the admin allowance editor requires a variation rule", () => {
  const source = read("components/offers/admin/offer-scope-page.tsx");
  const allowanceRow = source.slice(
    source.indexOf("function AllowanceRow"),
    source.indexOf("function ExclusionRow"),
  );

  assert.match(
    allowanceRow,
    /aria-label="Variation rule"/,
    "the allowance variation-rule input is gone",
  );
  assert.match(
    allowanceRow,
    /^\s+required$/m,
    "the allowance variation-rule input is not required",
  );
  assert.match(
    allowanceRow,
    /aria-required/,
    "the allowance variation-rule input is not marked required for assistive tech",
  );
});

test("Save stays off while an allowance variation rule is blank", () => {
  const source = read("components/offers/admin/offer-scope-page.tsx");
  assert.match(source, /disabled=\{missingVariationRule\}/);
  assert.match(
    source,
    /Every allowance needs a variation rule/,
    "the editor does not tell the admin why Save is off",
  );
});
