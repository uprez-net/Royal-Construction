import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NORMAL_WORKING_HOURS,
  scheduleTotalCost,
} from "../../utils/calculations";

test("an hourly price is costed per site day", () => {
  assert.equal(
    scheduleTotalCost(120, 3, "HOURLY"),
    120 * NORMAL_WORKING_HOURS * 3,
  );
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
  assert.ok(
    scheduleTotalCost(100, 5, "HOURLY") > scheduleTotalCost(100, 1, "HOURLY"),
  );
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
    // Split on either ending: on a CRLF checkout the trailing \r left every
    // line unstrippable by the comment regex below (`.` does not cross \r,
    // so `//.*$` never anchored) and the guard reported comments as
    // offenders.
    for (const [i, raw] of source.split(/\r?\n/).entries()) {
      const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      // A raw currency format of a price, not routed through the formatter.
      if (
        /rateCurrency\.format\(/.test(line) &&
        !/formatQuotedPrice|rateCurrency\.format,/.test(line)
      ) {
        offenders.push(`${file}:${i + 1}`);
      }
      // A hardcoded per-hour suffix next to a rendered value.
      if (/\/hr\b/.test(line) && !/formatQuotedPrice/.test(line)) {
        offenders.push(`${file}:${i + 1} (hardcoded /hr)`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `price rendered without its unit:\n${offenders.join("\n")}`,
  );
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

test("digits that are not the quote are never absorbed into it", () => {
  // Stripping non-digits concatenated everything: "Quote for REF-2024: $5000"
  // became 20,245,000, and "$1,200 plus $300 travel" became 1,200,300. Both
  // would have been stored and approved as the job price.
  assert.equal(parseQuotedAmount("Quote for REF-2024: $5000"), null);
  assert.equal(parseQuotedAmount("AUD 12abc34"), null);
  assert.equal(parseQuotedAmount("Ref 88 quote 500"), null);
});

test("two amounts in one message is a question, not a guess", () => {
  assert.equal(parseQuotedAmount("$1,200 plus $300 travel"), null);
  assert.equal(parseQuotedAmount("500 or 600 depending on access"), null);
});

test("a negative amount is not a quote", () => {
  assert.equal(parseQuotedAmount("-500"), null);
  assert.equal(parseQuotedAmount("$-1,200"), null);
});

test("a single amount is still read from a sentence", () => {
  assert.equal(parseQuotedAmount("Total: $12,345.67"), 12345.67);
  assert.equal(parseQuotedAmount("happy to do it for 4800"), 4800);
});

test("a genuine zero quote is preserved", () => {
  assert.equal(parseQuotedAmount("$0.00"), 0);
  assert.notEqual(parseQuotedAmount("$0.00"), null);
});

/* ── quote basis ───────────────────────────────────────────────────── */

import { normalizeQuoteBasis } from "../../utils/calculations";

test("a day rate is standardised to an hourly one at 8 hours a day", () => {
  // The column only stores HOURLY and FIXED, but tradies quote day rates
  // constantly. Storing "$950" as FIXED would price a 5-day job at $950.
  const quoted = normalizeQuoteBasis(950, "DAILY");
  assert.equal(quoted.unit, "HOURLY");
  assert.equal(quoted.amount, 950 / NORMAL_WORKING_HOURS);
  assert.equal(scheduleTotalCost(quoted.amount, 5, quoted.unit), 950 * 5);
});

test("hourly and fixed quotes pass through untouched", () => {
  assert.deepEqual(normalizeQuoteBasis(120, "HOURLY"), {
    amount: 120,
    unit: "HOURLY",
  });
  assert.deepEqual(normalizeQuoteBasis(4800, "FIXED"), {
    amount: 4800,
    unit: "FIXED",
  });
});

test("a normalised day rate is not rounded before it is costed", () => {
  // 1001/8 is 125.125. Rounding to the column's 2dp here and then multiplying
  // back out loses cents on every job; rounding belongs at the write.
  const quoted = normalizeQuoteBasis(1001, "DAILY");
  assert.equal(scheduleTotalCost(quoted.amount, 3, quoted.unit), 1001 * 3);
});

test("the same number means three different job totals", () => {
  // What the basis is actually for: $950 over a 4-day booking.
  const days = 4;
  const total = (basis: "FIXED" | "HOURLY" | "DAILY") => {
    const q = normalizeQuoteBasis(950, basis);
    return scheduleTotalCost(q.amount, days, q.unit);
  };
  assert.equal(total("FIXED"), 950);
  assert.equal(total("DAILY"), 3800);
  assert.equal(total("HOURLY"), 30400);
});
