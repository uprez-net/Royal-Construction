import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No runtime code may write a retired stage.
 *
 * 20260821030100 moved every lead off MEETING_SCHEDULED, IN_FOLLOW_UP, WON
 * and CANCELLED, but it ran before the deploy that stopped WRITING them, and
 * a booking in that window put a lead straight back onto Meeting Scheduled.
 * It surfaced as its own row on the Analytics tab, on a stage the picker no
 * longer offers. A second migration cleans that up; this test is what stops
 * a third being needed.
 *
 * It scans for the enum member or the UI label appearing as a written value
 * — a string literal next to `stage:` — rather than for any mention, so
 * the definitions, the stage map, filters and comments stay allowed.
 */
const RETIRED_ENUM = ["MEETING_SCHEDULED", "IN_FOLLOW_UP", "WON", "CANCELLED"];
const RETIRED_LABEL = ["Meeting Scheduled", "In Follow-up", "Won", "Cancelled"];
const ROOTS = ["app", "lib", "components", "hooks"];

// A written value, in the three shapes that actually assign one: a quoted
// literal after `stage:` or `stage =`, and the enum member itself
// (`stage: LeadStage.WON`). Reading one — isWonStage, an outcome, a filter
// list, the stage map — is untouched, which is the point: those all have to
// keep naming the retired stages so existing rows still render.
const WRITE_SHAPES = [
  ...[...RETIRED_ENUM, ...RETIRED_LABEL].flatMap((s) => [
    new RegExp(`stage:\\s*["'\`]${s}["'\`]`),
    new RegExp(`stage\\s*=\\s*["'\`]${s}["'\`]`),
  ]),
  ...RETIRED_ENUM.flatMap((s) => [
    new RegExp(`stage:\\s*\\w+\\.${s}\\b`),
    new RegExp(`stage\\s*=\\s*\\w+\\.${s}\\b`),
  ]),
];

/**
 * Comments are prose, and prose is allowed to name the retired stages — the
 * history of why they were retired is written down in several of these files.
 * Without this the scan trips on a JSDoc block in resolve-stage.ts quoting an
 * old `{stage: "Won", ...}` row as the bug it fixed.
 *
 * Block comments and whole-line comments only. Code lines are left intact, so
 * a trailing `// ...` cannot swallow a real assignment ahead of it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

test("nothing in runtime code assigns a retired stage", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const shape of WRITE_SHAPES) {
        if (shape.test(src)) offenders.push(`${file}  (${shape.source})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `retired stage written in:\n  ${offenders.join("\n  ")}`);
});
