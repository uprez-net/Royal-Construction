import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #479. The offer status popup was an unnamed dialog with no listbox, and
// focus stayed on the popup container, where cmdk's arrow, Home, End and Enter
// handler (on the list) never ran. The popup is closed during server render, so
// this pins the wiring at source level: the popup is named, focus goes to the
// named listbox on open, and the list is the cmdk CommandList.

const source = readFileSync(
  join(REPO_ROOT, "components/offers/offer-status-badge.tsx"),
  "utf8",
);

test("the status popup is named", () => {
  assert.match(source, /<PopoverContent\s+aria-label="Change status"/);
});

test("the options sit in a named cmdk listbox", () => {
  assert.match(source, /<CommandList ref=\{listRef\} label="Change status">/);
});

test("focus moves into the list when the popup opens", () => {
  assert.match(
    source,
    /onOpenAutoFocus=\{\(e\) => \{\s*e\.preventDefault\(\);\s*listRef\.current\?\.focus\(\);/,
  );
});
