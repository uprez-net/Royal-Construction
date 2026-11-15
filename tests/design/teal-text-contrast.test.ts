import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #482. The rich-text editor's AI Rewrite and Save note buttons, the
// email links, the metric card's primary tone and the project-create step
// bubbles painted white text on hard-coded teal (#0D9488 is 3.74:1) or Tailwind
// teal-500/600 (2.42:1 and 3.66:1). Normal text needs 4.5:1. They now use the
// royal gold ink, which measures 5.37:1 with white and as link text on white
// (see brand-contrast.test.ts). This guard keeps the teal fills and teal text
// from coming back on one line of a class list.

const ROOTS = ["app", "components"];
const SOURCE = /\.(?:tsx?|jsx?|css)$/;

// A teal fill under white text, or teal text, on the same line. Multi-line
// class lists are not read whole here, so keep the pair on one line.
const TEAL_FILL = /(?<![\w-])bg-(?:\[#0d9488\]|teal-[456]00)(?![\w-])/i;
const WHITE_TEXT = /(?<![\w-])text-white(?![\w-])/;
const TEAL_TEXT = /(?<![\w-])text-\[#0d9488\]/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { recursive: true })
    .map(String)
    .filter((name) => SOURCE.test(name))
    .map((name) => join(dir, name));
}

test("no teal fill sits under white text, and no teal hex is used as text, in app/ or components/", () => {
  const offences: string[] = [];

  for (const file of ROOTS.flatMap(sourceFiles)) {
    const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      const where = `${relative(REPO_ROOT, join(REPO_ROOT, file))}:${index + 1}`;
      if (TEAL_FILL.test(line) && WHITE_TEXT.test(line)) {
        offences.push(`${where} teal fill under white text`);
      }
      if (TEAL_TEXT.test(line)) {
        offences.push(`${where} teal hex as text`);
      }
    });
  }

  assert.deepEqual(offences, []);
});
