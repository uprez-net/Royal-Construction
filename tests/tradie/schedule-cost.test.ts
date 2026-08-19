import assert from "node:assert/strict";
import { test } from "node:test";

import { NORMAL_WORKING_HOURS, scheduleTotalCost } from "../../utils/calculations";

test("an hourly price is costed per site day", () => {
  assert.equal(scheduleTotalCost(120, 3, "HOURLY"), 120 * NORMAL_WORKING_HOURS * 3);
});

test("a fixed price is the whole job, however long it takes", () => {
  // The bug this exists for: 4800 quoted for a 5-day job used to report
  // 4800 x 8 x 5 = $192,000.
  assert.equal(scheduleTotalCost(4800, 5, "FIXED"), 4800);
  assert.equal(scheduleTotalCost(4800, 1, "FIXED"), 4800);
});

test("duration does not change a fixed price", () => {
  const one = scheduleTotalCost(2500, 1, "FIXED");
  const ten = scheduleTotalCost(2500, 10, "FIXED");
  assert.equal(one, ten);
});

test("hourly still scales with duration", () => {
  assert.ok(scheduleTotalCost(100, 5, "HOURLY") > scheduleTotalCost(100, 1, "HOURLY"));
});

test("zero duration costs nothing hourly but still owes a fixed quote", () => {
  assert.equal(scheduleTotalCost(120, 0, "HOURLY"), 0);
  assert.equal(scheduleTotalCost(4800, 0, "FIXED"), 4800);
});

/* ── display ───────────────────────────────────────────────────────── */

import { formatQuotedPrice } from "../../utils/calculations";

const money = (n: number) => `$${n.toFixed(2)}`;

test("a fixed price never renders as a rate", () => {
  // "/hr" was hardcoded at five display sites, so recording the unit changed
  // the maths while every screen still said per-hour.
  const shown = formatQuotedPrice(4800, "FIXED", money);
  assert.ok(!shown.includes("/hr"), `fixed price rendered as a rate: ${shown}`);
  assert.match(shown, /fixed/);
});

test("an hourly price still renders as a rate", () => {
  assert.equal(formatQuotedPrice(120, "HOURLY", money), "$120.00/hr");
});

test("no component renders a tradie price without its unit", async () => {
  // Three review rounds found the same bug in twelve places: the unit was
  // recorded, the maths respected it, and the screen still said "/hr". This
  // pins the rule rather than relying on the next reviewer to spot the
  // thirteenth site.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory()
        ? walk(full)
        : full.endsWith(".tsx")
          ? [full]
          : [];
    });

  const offenders: string[] = [];
  for (const file of walk("components")) {
    const source = readFileSync(file, "utf8");
    for (const [i, raw] of source.split("\n").entries()) {
      const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      // A raw currency format of a price, not routed through the formatter.
      if (/rateCurrency\.format\(/.test(line) && !/formatQuotedPrice|rateCurrency\.format,/.test(line)) {
        offenders.push(`${file}:${i + 1}`);
      }
      // A hardcoded per-hour suffix next to a rendered value.
      if (/\/hr\b/.test(line) && !/formatQuotedPrice/.test(line)) {
        offenders.push(`${file}:${i + 1} (hardcoded /hr)`);
      }
    }
  }
  assert.deepEqual(offenders, [], `price rendered without its unit:\n${offenders.join("\n")}`);
});

/* ── emailed quotes ────────────────────────────────────────────────── */

import { parseQuotedAmount } from "../../utils/calculations";

test("a quote is parsed out of the text a tradie actually sends", () => {
  // The extractor asks for e.g. "$5000.00", but people write it many ways.
  assert.equal(parseQuotedAmount("$5,000.00"), 5000);
  assert.equal(parseQuotedAmount("5000"), 5000);
  assert.equal(parseQuotedAmount(" $ 4,800.50 "), 4800.5);
  assert.equal(parseQuotedAmount("AUD 1200"), 1200);
});

test("an unparseable quote is null, never zero", () => {
  // Zero is a real quote. A failed parse must not masquerade as one, or the
  // job silently costs nothing.
  for (const raw of ["", "  ", "TBC", "call me", null, undefined, "1.2.3"]) {
    assert.equal(parseQuotedAmount(raw), null, JSON.stringify(raw));
  }
});

test("a genuine zero quote is preserved", () => {
  assert.equal(parseQuotedAmount("$0.00"), 0);
  assert.notEqual(parseQuotedAmount("$0.00"), null);
});
