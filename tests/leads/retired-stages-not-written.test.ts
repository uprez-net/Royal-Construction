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
const RETIRED = ["MEETING_SCHEDULED", "IN_FOLLOW_UP", "Meeting Scheduled", "In Follow-up"];
const ROOTS = ["app", "lib", "components", "hooks"];
const WRITE_SHAPES = RETIRED.flatMap((s) => [
  new RegExp(`stage:\\s*["'\`]${s}["'\`]`),
  new RegExp(`stage\\s*=\\s*["'\`]${s}["'\`]`),
]);

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
      const src = readFileSync(file, "utf8");
      for (const shape of WRITE_SHAPES) {
        if (shape.test(src)) offenders.push(`${file}  (${shape.source})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `retired stage written in:\n  ${offenders.join("\n  ")}`);
});
