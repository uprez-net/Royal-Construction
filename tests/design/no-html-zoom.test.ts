import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #437. The app used to compact itself below 1280px with
// `html { zoom: 0.9 }`. Radix/Floating UI position every popper (Select,
// Popover, DropdownMenu, so every filter and lookup menu) from the trigger's
// pixel position, and under CSS `zoom` that offset is scaled a second time:
// menus opened up to ~50px from their trigger. The compaction is now a root
// font-size. This pins it, because the failure is invisible in code review and
// only shows in a browser narrower than 1280px.

const css = readFileSync(join(REPO_ROOT, "app/globals.css"), "utf8");

// Comments may name `zoom` to explain why it is banned.
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("no rule sets CSS zoom on html or body", () => {
  const rules = withoutComments.matchAll(
    /(^|[}\s,])(html|body)\b[^{}]*\{([^{}]*)\}/g,
  );
  for (const [, , selector, declarations] of rules) {
    assert.doesNotMatch(
      declarations,
      /(^|[;\s])zoom\s*:/,
      `\`${selector}\` must not set zoom (#437): scale with font-size instead`,
    );
  }
});

test("the compact scale below 1280px is a root font-size", () => {
  assert.match(
    withoutComments,
    /@media \(min-width: 1024px\)\s*\{\s*html\s*\{\s*font-size:\s*90%/,
  );
  assert.match(
    withoutComments,
    /@media \(min-width: 1280px\)\s*\{\s*html\s*\{\s*font-size:\s*100%/,
  );
});
