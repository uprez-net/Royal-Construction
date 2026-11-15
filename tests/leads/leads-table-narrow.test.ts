import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #483. Below 1024px the Leads Actions column (12% of the table) was
// narrower than the six row icons need, so the Archive and Meeting icons were
// clipped by their cell and still focusable. The table now keeps a minimum
// width below 1024px, in rem so it scales with the root, and the wrapper
// scrolls. Browser layout is checked by hand; this pins the rule and its
// arithmetic, which is what a later edit would quietly break.

const css = readFileSync(join(REPO_ROOT, "app/globals.css"), "utf8");
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("below 1024px the Leads table keeps a minimum width in rem", () => {
  const rule = withoutComments.match(
    /@media \(max-width: 1023px\)\s*\{\s*\.leads-table\s*\{\s*min-width:\s*(\d+(?:\.\d+)?)rem;\s*\}\s*\}/,
  );
  assert.ok(
    rule,
    "expected @media (max-width: 1023px) .leads-table { min-width: …rem }",
  );
  const minRem = Number(rule[1]);

  // The Actions column is 12% of the table. Six icons need about 118px at a
  // 16px root (#470), so 12% of the minimum must clear 7.375rem.
  const actionsShare = withoutComments.match(
    /\.leads-table \.col-actions\s*\{\s*width:\s*(\d+)%/,
  );
  assert.ok(actionsShare, "the Actions column keeps its percentage width");
  assert.ok(
    (minRem * Number(actionsShare[1])) / 100 >= 7.375,
    `12% of ${minRem}rem must clear the six-icon width (7.375rem)`,
  );
});
