import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";

import {
  coerceMoney,
  computeForecast,
  computePipelineMetrics,
  computeWinRate,
  probabilityFor,
  weightedValueOf,
  type LeadForMetrics,
} from "../../lib/leads/pipeline-math";
import { PIPELINE_STAGES } from "../../lib/leads/pipeline-stages";

function lead(over: Partial<LeadForMetrics> = {}): LeadForMetrics {
  return {
    id: 1,
    stage: "QUOTED",
    estimatedValue: "100000",
    probabilityOverride: null,
    expectedCloseDate: null,
    wonAt: null,
    lostAt: null,
    ...over,
  };
}

const NOW = new Date("2026-08-16T02:00:00.000Z"); // FY2027 Q1

// Read off the ladder rather than restated. These assertions are about the
// arithmetic, and a second hardcoded copy of the probabilities only breaks in
// a heap the next time the ladder is tuned.
const P = (code: keyof typeof PIPELINE_STAGES) => PIPELINE_STAGES[code].probability;

/* ── coercion & weighting ─────────────────────────────────────────── */

test("coerceMoney accepts numbers, numeric strings and Decimals", () => {
  assert.equal(coerceMoney(1234.56)?.toString(), "1234.56");
  assert.equal(coerceMoney("1234.56")?.toString(), "1234.56");
  assert.equal(coerceMoney(new Prisma.Decimal("1234.56"))?.toString(), "1234.56");
  assert.equal(coerceMoney("0")?.toString(), "0");
});

test("coerceMoney treats unusable input as absent, never as zero and never throwing", () => {
  // Prisma.Decimal THROWS on these — the whole reason this function exists.
  assert.equal(coerceMoney(""), null);
  assert.equal(coerceMoney("abc"), null);
  assert.equal(coerceMoney("  "), null);
  assert.equal(coerceMoney(null), null);
  assert.equal(coerceMoney(undefined), null);
  assert.equal(coerceMoney(Number.NaN), null);
  assert.equal(coerceMoney(Number.POSITIVE_INFINITY), null);
});

test("coerceMoney rejects negative values", () => {
  assert.equal(coerceMoney(-1), null);
  assert.equal(coerceMoney("-500000"), null);
});

test("probabilityFor falls back to the stage default", () => {
  assert.equal(probabilityFor(lead({ stage: "NEGOTIATING" })), P("NEGOTIATING"));
  assert.equal(probabilityFor(lead({ stage: "NEW" })), P("NEW"));
  assert.equal(probabilityFor(lead({ stage: "CONVERTED" })), P("CONVERTED"));
});

test("probabilityFor honours an explicit override", () => {
  assert.equal(probabilityFor(lead({ stage: "NEW", probabilityOverride: 85 })), 85);
  assert.equal(probabilityFor(lead({ stage: "NEGOTIATING", probabilityOverride: 0 })), 0);
});

test("a closed stage outranks any stale override", () => {
  // A lead can carry an override set while it was open (say 60% at
  // Negotiating). Winning the deal does not clear that column, so without this
  // rule a won deal weights at 60% — and forecast.weightedValue then comes out
  // BELOW the forecast.wonValue it is supposed to contain in full.
  assert.equal(probabilityFor(lead({ stage: "WON", probabilityOverride: 60 })), 100);
  assert.equal(probabilityFor(lead({ stage: "CONVERTED", probabilityOverride: 5 })), 100);
  assert.equal(probabilityFor(lead({ stage: "LOST", probabilityOverride: 90 })), 0);
  assert.equal(probabilityFor(lead({ stage: "CANCELLED", probabilityOverride: 90 })), 0);
  // Open stages still honour the override.
  assert.equal(probabilityFor(lead({ stage: "NEGOTIATING", probabilityOverride: 60 })), 60);
});

test("forecast weightedValue always contains wonValue in full", () => {
  const forecast = computeForecast(
    [
      lead({
        id: 1, stage: "WON", estimatedValue: "800000",
        probabilityOverride: 60, // stale, set while the lead was still open
        expectedCloseDate: "2026-08-01T02:00:00Z",
      }),
    ],
    2027,
    1,
  );
  assert.equal(forecast.wonValue.toString(), "800000");
  assert.equal(forecast.weightedValue.toString(), "800000");
  assert.ok(
    forecast.weightedValue.greaterThanOrEqualTo(forecast.wonValue),
    "weighted must never fall below won",
  );
});

test("probabilityFor clamps and rounds, and survives NaN", () => {
  assert.equal(probabilityFor(lead({ probabilityOverride: 150 })), 100);
  assert.equal(probabilityFor(lead({ probabilityOverride: -20 })), 0);
  assert.equal(probabilityFor(lead({ probabilityOverride: 79.6 })), 80);
  // Math.trunc(NaN) is NaN and survives a clamp — must fall back to the stage.
  assert.equal(probabilityFor(lead({ stage: "QUOTED", probabilityOverride: Number.NaN })), P("QUOTED"));
});

test("weightedValueOf multiplies value by probability", () => {
  assert.equal(
    weightedValueOf(lead({ stage: "NEGOTIATING", estimatedValue: "842150" })).toString(),
    String(842150 * P("NEGOTIATING") / 100),
  );
  assert.equal(
    weightedValueOf(lead({ stage: "NEW", estimatedValue: "620000" })).toString(),
    String(620000 * P("NEW") / 100),
  );
});

test("weightedValueOf rounds to two decimal places", () => {
  assert.equal(
    weightedValueOf(lead({ stage: "QUALIFIED", estimatedValue: "1" })).toString(),
    "0.45",
  );
});

test("weightedValueOf returns zero — never NaN — for unusable values", () => {
  for (const value of ["", "abc", null, undefined, Number.NaN, -5]) {
    const result = weightedValueOf(lead({ estimatedValue: value as never }));
    assert.equal(result.isNaN(), false, `NaN escaped for ${String(value)}`);
    assert.equal(result.toString(), "0");
  }
});

test("a NaN probability cannot poison a weighted value", () => {
  const result = weightedValueOf(
    lead({ stage: "QUOTED", estimatedValue: "100", probabilityOverride: Number.NaN }),
  );
  assert.equal(result.isNaN(), false);
  assert.equal(result.toString(), String(P("QUOTED")));
});

/* ── pipeline metrics ─────────────────────────────────────────────── */

test("computePipelineMetrics counts only open leads", () => {
  const metrics = computePipelineMetrics(
    [
      lead({ id: 1, stage: "QUOTED", estimatedValue: "100000" }),
      lead({ id: 2, stage: "WON", estimatedValue: "500000" }),
      lead({ id: 3, stage: "LOST", estimatedValue: "500000" }),
      lead({ id: 4, stage: "NO_RESPONSE", estimatedValue: "500000" }),
    ],
    NOW,
  );
  assert.equal(metrics.openCount, 1);
  assert.equal(metrics.totalValue.toString(), "100000");
  assert.equal(metrics.weightedValue.toString(), String(100000 * P("QUOTED") / 100));
});

test("computePipelineMetrics groups by stage in display order", () => {
  const metrics = computePipelineMetrics(
    [
      lead({ id: 1, stage: "NEGOTIATING", estimatedValue: "200000" }),
      lead({ id: 2, stage: "NEW", estimatedValue: "100000" }),
      lead({ id: 3, stage: "NEW", estimatedValue: "300000" }),
    ],
    NOW,
  );
  assert.deepEqual(
    metrics.byStage.map((b) => b.code),
    ["NEW", "NEGOTIATING"],
  );
  const [newBucket, negotiating] = metrics.byStage;
  assert.equal(newBucket.count, 2);
  assert.equal(newBucket.total.toString(), "400000");
  assert.equal(newBucket.weighted.toString(), String(400000 * P("NEW") / 100));
  assert.equal(negotiating.weighted.toString(), String(200000 * P("NEGOTIATING") / 100));
});

test("computePipelineMetrics reports unusable and missing values", () => {
  const metrics = computePipelineMetrics(
    [
      lead({ id: 1, estimatedValue: "100000" }),
      lead({ id: 2, estimatedValue: null }),
      lead({ id: 3, estimatedValue: "-5" }),
    ],
    NOW,
  );
  assert.equal(metrics.openCount, 3);
  assert.equal(metrics.valuedCount, 1);
  assert.equal(metrics.invalidValueCount, 1);
  assert.equal(metrics.totalValue.toString(), "100000");
});

test("an empty pipeline yields zeros and never NaN", () => {
  const metrics = computePipelineMetrics([], NOW);
  assert.equal(metrics.openCount, 0);
  assert.equal(metrics.totalValue.toString(), "0");
  assert.equal(metrics.totalValue.isNaN(), false);
  assert.equal(metrics.weightedValue.isNaN(), false);
  assert.deepEqual(metrics.byStage, []);
  assert.equal(metrics.winRate.percent, null);
});

/* ── win rate ─────────────────────────────────────────────────────── */

test("computeWinRate divides wins by decisions", () => {
  const from = new Date("2026-05-18T14:00:00Z");
  const rate = computeWinRate(
    [
      lead({ id: 1, stage: "WON", wonAt: "2026-07-01T00:00:00Z" }),
      lead({ id: 2, stage: "CONVERTED", wonAt: "2026-07-15T00:00:00Z" }),
      lead({ id: 3, stage: "LOST", lostAt: "2026-07-20T00:00:00Z" }),
      lead({ id: 4, stage: "QUOTED" }),
      lead({ id: 5, stage: "NO_RESPONSE" }),
    ],
    from,
    NOW,
  );
  assert.equal(rate.won, 2);
  assert.equal(rate.lost, 1);
  assert.equal(rate.percent, 67); // 2/3 -> 66.67 -> 67
});

test("computeWinRate returns null rather than zero or NaN when nothing closed", () => {
  const rate = computeWinRate([lead({ id: 1, stage: "QUOTED" })], new Date("2026-05-18T14:00:00Z"), NOW);
  assert.equal(rate.percent, null);
  assert.equal(rate.won, 0);
  assert.equal(rate.lost, 0);
});

test("computeWinRate ignores closes outside the window", () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const rate = computeWinRate(
    [
      lead({ id: 1, stage: "WON", wonAt: "2026-06-01T00:00:00Z" }),
      lead({ id: 2, stage: "WON", wonAt: "2026-07-10T00:00:00Z" }),
    ],
    from,
    NOW,
  );
  assert.equal(rate.won, 1);
});

test("win rate flags estimated dates for windows reaching before tracking began", () => {
  const metrics = computePipelineMetrics([], NOW);
  assert.equal(metrics.winRate.estimatedDates, true);
  assert.equal(metrics.winRate.windowDays, 90);

  const later = computePipelineMetrics([], new Date("2027-01-01T00:00:00Z"));
  assert.equal(later.winRate.estimatedDates, false);
});

/* ── forecast ─────────────────────────────────────────────────────── */

test("computeForecast splits expected, weighted, won and banked", () => {
  const forecast = computeForecast(
    [
      // Won this quarter, full value.
      lead({ id: 1, stage: "CONVERTED", estimatedValue: "1240000", expectedCloseDate: "2026-08-01T00:00:00Z", wonAt: "2026-08-01T00:00:00Z" }),
      // Negotiating this quarter, weighted, NOT banked.
      lead({ id: 2, stage: "NEGOTIATING", estimatedValue: "842150", expectedCloseDate: "2026-09-12T00:00:00Z" }),
      // Quoted this quarter, weighted, NOT banked.
      lead({ id: 3, stage: "QUOTED", estimatedValue: "400000", expectedCloseDate: "2026-09-20T00:00:00Z" }),
      // Next quarter — excluded entirely.
      lead({ id: 4, stage: "NEGOTIATING", estimatedValue: "900000", expectedCloseDate: "2026-11-01T00:00:00Z" }),
      // No close date — excluded.
      lead({ id: 5, stage: "QUOTED", estimatedValue: "700000" }),
      // Lost this quarter — excluded.
      lead({ id: 6, stage: "LOST", estimatedValue: "500000", expectedCloseDate: "2026-08-05T00:00:00Z" }),
    ],
    2027,
    1,
  );
  assert.equal(forecast.label, "FY2027 Q1");
  assert.equal(forecast.dealCount, 3);
  assert.equal(forecast.expectedValue.toString(), "2482150"); // 1240000+842150+400000
  assert.equal(forecast.wonValue.toString(), "1240000");
  // Banked is won-only. It used to include Negotiating, which meant this
  // number claimed 842150 the customer had not agreed to.
  assert.equal(forecast.bankedValue.toString(), "1240000");
  assert.equal(forecast.bankedValue.toString(), forecast.wonValue.toString());
  const expectedWeighted =
    1240000 + (842150 * P("NEGOTIATING")) / 100 + (400000 * P("QUOTED")) / 100;
  assert.equal(forecast.weightedValue.toString(), String(expectedWeighted));
});

test("computeForecast counts a won deal once, not twice", () => {
  const forecast = computeForecast(
    [lead({ id: 1, stage: "WON", estimatedValue: "1000000", expectedCloseDate: "2026-08-01T00:00:00Z" })],
    2027,
    1,
  );
  assert.equal(forecast.expectedValue.toString(), "1000000");
  assert.equal(forecast.weightedValue.toString(), "1000000");
  assert.equal(forecast.bankedValue.toString(), "1000000");
});

test("computeForecast includes a deal on the quarter's last local day", () => {
  const forecast = computeForecast(
    [lead({ id: 1, stage: "QUOTED", estimatedValue: "100000", expectedCloseDate: "2026-09-30T13:59:00Z" })],
    2027,
    1,
  );
  assert.equal(forecast.dealCount, 1);
});

test("computeForecast excludes a deal at the next quarter's first local midnight", () => {
  const forecast = computeForecast(
    [lead({ id: 1, stage: "QUOTED", estimatedValue: "100000", expectedCloseDate: "2026-09-30T14:00:00Z" })],
    2027,
    1,
  );
  assert.equal(forecast.dealCount, 0);
});

test("an empty forecast is all zeros and never NaN", () => {
  const forecast = computeForecast([], 2027, 1);
  for (const field of [forecast.expectedValue, forecast.weightedValue, forecast.wonValue, forecast.bankedValue]) {
    assert.equal(field.isNaN(), false);
    assert.equal(field.toString(), "0");
  }
});
