import { Prisma } from "@prisma/client";
import type { LeadStage } from "@prisma/client";

import { fyQuarterBounds, type FyQuarter } from "./fy-quarter";
import {
  CLOSE_DATE_TRACKING_START,
  WIN_RATE_WINDOW_DAYS,
  isOpenStage,
  stageDef,
} from "./pipeline-stages";

/** The projection every aggregate in this module operates on. */
export interface LeadForMetrics {
  id: number;
  stage: LeadStage;
  /** Decimal columns arrive as strings over JSON and from the data layer. */
  estimatedValue: string | number | Prisma.Decimal | null;
  probabilityOverride: number | null;
  expectedCloseDate: Date | string | null;
  wonAt: Date | string | null;
  lostAt: Date | string | null;
}

export const ZERO = new Prisma.Decimal(0);

/**
 * Parse a money value defensively.
 *
 * `new Prisma.Decimal("")` and `new Prisma.Decimal("abc")` THROW — decimal.js
 * never yields NaN from a bad string, so an `isNaN()` guard after construction
 * is dead code. Strings are the realistic input: Decimal serialises to a
 * string over JSON.
 *
 * Returns null for anything unusable, which callers treat as "no value
 * recorded" — deliberately NOT zero, so an unparseable figure does not quietly
 * drag an average down.
 */
export function coerceMoney(
  value: string | number | Prisma.Decimal | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Prisma.Decimal) {
    if (value.isNaN() || !value.isFinite() || value.isNegative()) return null;
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return new Prisma.Decimal(value);
  }

  const trimmed = value.trim();
  if (trimmed === "") return null;

  try {
    const parsed = new Prisma.Decimal(trimmed);
    if (parsed.isNaN() || !parsed.isFinite() || parsed.isNegative())
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Total estimated value of the leads in `stages`. A missing or unusable value
 * adds nothing (it is counted by `countLeadsWithoutValue`, not guessed).
 */
export function sumValueInStages(
  leads: readonly LeadForMetrics[],
  stages: ReadonlySet<LeadStage>,
): Prisma.Decimal {
  return leads.reduce(
    (total, lead) =>
      stages.has(lead.stage)
        ? total.add(coerceMoney(lead.estimatedValue) ?? ZERO)
        : total,
    ZERO,
  );
}

/**
 * How many of the given leads, among those in `openStages`, carry no usable
 * estimated value: nothing entered, something unparseable, or zero. A $0
 * estimate adds nothing to the pipeline, so for "which leads still need a
 * number" it counts as missing (`computePipelineMetrics` counts it as valued).
 */
export function countLeadsWithoutValue(
  leads: readonly LeadForMetrics[],
  openStages: ReadonlySet<LeadStage>,
): number {
  return leads.filter((lead) => {
    if (!openStages.has(lead.stage)) return false;
    const value = coerceMoney(lead.estimatedValue);
    return value === null || value.isZero();
  }).length;
}

/**
 * Effective likelihood for a lead: its override when set and usable,
 * otherwise the stage default.
 *
 * `Math.trunc(NaN)` is NaN and survives `Math.max`/`Math.min`, so the finite
 * check must come before the clamp — otherwise one bad row turns every
 * downstream sum into NaN.
 */
export function probabilityFor(lead: LeadForMetrics): number {
  const def = stageDef(lead.stage);

  // A settled deal's likelihood is a fact, not an opinion, so a closed stage
  // outranks any override. Overrides are not cleared when a lead closes, so
  // without this a deal won at a stale 60% would weight to 60% of its value —
  // making forecast.weightedValue come out BELOW the forecast.wonValue it is
  // supposed to contain in full.
  if (def.outcome === "WON") return 100;
  if (def.outcome === "LOST") return 0;

  const fallback = def.probability;
  const override = lead.probabilityOverride;

  if (override === null || override === undefined) return fallback;
  const numeric = Number(override);
  if (!Number.isFinite(numeric)) return fallback;

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

/** value x probability / 100, to 2dp. Never NaN. */
export function weightedValueOf(lead: LeadForMetrics): Prisma.Decimal {
  const value = coerceMoney(lead.estimatedValue);
  if (value === null) return ZERO;

  return value
    .mul(probabilityFor(lead))
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/* ── aggregates ───────────────────────────────────────────────────── */

export interface StageBucket {
  code: LeadStage;
  label: string;
  order: number;
  colorVar: string;
  probability: number;
  count: number;
  total: Prisma.Decimal;
  weighted: Prisma.Decimal;
}

export interface WinRate {
  /** null when nothing closed in the window — the UI renders an em dash. */
  percent: number | null;
  won: number;
  lost: number;
  windowDays: number;
  /** True while the window reaches back before real tracking began. */
  estimatedDates: boolean;
}

export interface PipelineMetrics {
  openCount: number;
  valuedCount: number;
  invalidValueCount: number;
  totalValue: Prisma.Decimal;
  weightedValue: Prisma.Decimal;
  byStage: StageBucket[];
  winRate: WinRate;
}

export interface ForecastResult {
  fy: number;
  quarter: FyQuarter;
  label: string;
  start: string;
  endExclusive: string;
  dealCount: number;
  /** Face value of deals expected to close in the window. */
  expectedValue: Prisma.Decimal;
  /**
   * The same deals, probability-weighted. Won deals sit at 100%, so they
   * contribute in full through the ordinary path — no special case, and no
   * second quantity sharing this name.
   */
  weightedValue: Prisma.Decimal;
  /** Already-won deals in the window. */
  wonValue: Prisma.Decimal;
  /** wonValue plus open deals in banked stages (Negotiating). */
  bankedValue: Prisma.Decimal;
}

const MS_PER_DAY = 86_400_000;

function toDate(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Wins over decisions in [from, to). Null percent when nothing closed. */
export function computeWinRate(
  leads: LeadForMetrics[],
  from: Date,
  to: Date,
): WinRate {
  let won = 0;
  let lost = 0;

  for (const lead of leads) {
    const outcome = stageDef(lead.stage).outcome;
    // STALLED leads reach neither branch: not a win, not a loss.
    if (outcome === "WON") {
      const at = toDate(lead.wonAt);
      if (at && at >= from && at < to) won += 1;
    } else if (outcome === "LOST") {
      const at = toDate(lead.lostAt);
      if (at && at >= from && at < to) lost += 1;
    }
  }

  const decisions = won + lost;
  return {
    percent: decisions === 0 ? null : Math.round((won / decisions) * 100),
    won,
    lost,
    windowDays: Math.round((to.getTime() - from.getTime()) / MS_PER_DAY),
    estimatedDates: from < CLOSE_DATE_TRACKING_START,
  };
}

export function computePipelineMetrics(
  leads: LeadForMetrics[],
  now: Date,
): PipelineMetrics {
  let openCount = 0;
  let valuedCount = 0;
  let invalidValueCount = 0;
  let totalValue = ZERO;
  let weightedValue = ZERO;

  const buckets = new Map<LeadStage, StageBucket>();

  for (const lead of leads) {
    if (!isOpenStage(lead.stage)) continue;
    openCount += 1;

    const value = coerceMoney(lead.estimatedValue);
    if (value === null) {
      // Distinguish "never entered" from "entered but unusable".
      if (lead.estimatedValue !== null && lead.estimatedValue !== undefined) {
        invalidValueCount += 1;
      }
    } else {
      valuedCount += 1;
    }

    const face = value ?? ZERO;
    const weighted = weightedValueOf(lead);
    totalValue = totalValue.add(face);
    weightedValue = weightedValue.add(weighted);

    const def = stageDef(lead.stage);
    let bucket = buckets.get(lead.stage);
    if (!bucket) {
      bucket = {
        code: def.code,
        label: def.label,
        order: def.order,
        colorVar: def.colorVar,
        probability: def.probability,
        count: 0,
        total: ZERO,
        weighted: ZERO,
      };
      buckets.set(lead.stage, bucket);
    }
    bucket.count += 1;
    bucket.total = bucket.total.add(face);
    bucket.weighted = bucket.weighted.add(weighted);
  }

  const windowStart = new Date(
    now.getTime() - WIN_RATE_WINDOW_DAYS * MS_PER_DAY,
  );

  return {
    openCount,
    valuedCount,
    invalidValueCount,
    totalValue,
    weightedValue,
    byStage: [...buckets.values()].sort((a, b) => a.order - b.order),
    winRate: computeWinRate(leads, windowStart, now),
  };
}

export function computeForecast(
  leads: LeadForMetrics[],
  fy: number,
  quarter: FyQuarter,
): ForecastResult {
  const { start, endExclusive, label } = fyQuarterBounds(fy, quarter);

  let dealCount = 0;
  let expectedValue = ZERO;
  let weightedValue = ZERO;
  let wonValue = ZERO;
  let bankedValue = ZERO;

  for (const lead of leads) {
    const def = stageDef(lead.stage);
    // Lost and stalled deals are not forecast.
    if (def.outcome === "LOST" || def.outcome === "STALLED") continue;

    const closeDate = toDate(lead.expectedCloseDate);
    if (!closeDate || closeDate < start || closeDate >= endExclusive) continue;

    const face = coerceMoney(lead.estimatedValue) ?? ZERO;
    const weighted = weightedValueOf(lead);

    dealCount += 1;
    expectedValue = expectedValue.add(face);
    weightedValue = weightedValue.add(weighted);

    if (def.outcome === "WON") wonValue = wonValue.add(face);
    if (def.banked) bankedValue = bankedValue.add(face);
  }

  return {
    fy,
    quarter,
    label,
    start: start.toISOString(),
    endExclusive: endExclusive.toISOString(),
    dealCount,
    expectedValue,
    weightedValue,
    wonValue,
    bankedValue,
  };
}
