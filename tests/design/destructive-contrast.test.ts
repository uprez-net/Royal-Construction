import assert from "node:assert/strict";
import { test } from "vitest";

import {
  WHITE,
  contrastRatio,
  readGlobalsCss,
  themeColour,
} from "./oklch-contrast";

// Issue #444. `--destructive` measured 4.31:1 as text on --background in the
// light theme, under the 4.5:1 that small text needs. Any `text-xs
// text-destructive` form error failed it, including the public booking page.
// Measures the declared tokens, as brand-contrast.test.ts does for gold.

const AA_TEXT = 4.5;
const css = readGlobalsCss();
const ratio = (value: number) => `${value.toFixed(2)}:1`;

test("destructive text clears AA on the page and on cards", () => {
  const destructive = themeColour(css, ":root", "--destructive");
  for (const surface of ["--background", "--card"]) {
    const measured = contrastRatio(
      destructive,
      themeColour(css, ":root", surface),
    );
    assert.ok(
      measured >= AA_TEXT,
      `--destructive on ${surface} measures ${ratio(measured)}`,
    );
  }
});

test("white text on a destructive button clears AA", () => {
  const measured = contrastRatio(
    WHITE,
    themeColour(css, ":root", "--destructive"),
  );
  assert.ok(
    measured >= AA_TEXT,
    `white on --destructive measures ${ratio(measured)}`,
  );
});

test("the destructive ink stays at least as dark as the destructive fill", () => {
  assert.ok(
    themeColour(css, ":root", "--destructive-ink").lightness
      <= themeColour(css, ":root", "--destructive").lightness,
  );
});
