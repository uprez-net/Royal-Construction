import {
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { budgetBracket } from "@/lib/leads/lead-helpers";

/**
 * HBCF (Home Building Compensation Fund) claim capacity.
 *
 * A builder's HBCF eligibility is a finite pool: every project under way holds
 * part of it until that project's cover period ends, at which point the amount
 * returns to the free pool. This module is the deterministic core behind the
 * lead detail card — the pure arithmetic lives here so it can be tested without
 * a database, and `lib/data/insurance.ts` only supplies it with rows.
 *
 * Everything is whole AUD dollars. No minor units anywhere in this feature.
 */

/* -------------------------------------------------------------------------- */
/*                            Product constants                               */
/* -------------------------------------------------------------------------- */

/**
 * Total capacity of the HBCF pool.
 *
 * PRODUCT INPUT NEEDED: this is an org-wide placeholder matching the design
 * reference, not a figure sourced from the insurer. A builder's real eligibility
 * limit is set by their HBCF broker and can be renegotiated, so when product
 * confirms the number — or decides it belongs in a settings row — this constant
 * is the single place that changes.
 */
export const HBCF_TOTAL_SUM_ASSURED = 8_000_000;

/**
 * Half-width of the cover band placed around a lead's recorded value, when that
 * value is a single number rather than a bracket. Cover has to absorb variations
 * on top of the contract price, so the band is deliberately asymmetric-free but
 * wide enough not to read as a precise quote.
 */
export const HBCF_NEED_BAND = 0.1;

/** Fallback projection length when there are no claim windows to average. */
export const HBCF_DEFAULT_PROJECTION_MONTHS = 12;

/** Bounds on the derived projection so one freak claim window cannot distort it. */
const PROJECTION_MONTH_BOUNDS = { min: 3, max: 36 } as const;

const DAYS_PER_MONTH = 30.44;

/**
 * Chart tokens, in assignment order. Each active claim takes the next colour and
 * keeps it across the legend, the per-project list and its Gantt row.
 */
export const HBCF_CLAIM_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-5)",
] as const;

/** The unallocated remainder of the pool. */
export const HBCF_FREE_COLOUR = "var(--muted-foreground)";

export function hbcfClaimColour(index: number) {
  return HBCF_CLAIM_PALETTE[index % HBCF_CLAIM_PALETTE.length];
}

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

/** One project holding part of the pool. Deliberately minimal — see §5. */
export interface HbcfProjectClaim {
  projectId: string;
  /** The project's own name, which is long-form (`clients — site address`). */
  projectName: string;
  /** The originating lead's name; preferred as the short label. May be absent. */
  leadName: string | null;
  /** `yyyy-MM-dd` */
  insuranceClaimStartDate: string;
  /** `yyyy-MM-dd` */
  insuranceClaimEndDate: string;
  /** Whole AUD dollars of cover this project holds. */
  claimAmount: number;
}

export interface HbcfNeedRange {
  low: number;
  high: number;
  /** Which lead field the range came from, so the UI can caption it honestly. */
  source: "estimatedValue" | "budgetBracket";
  /** True when the upper bound is a display cap, not a real ceiling. */
  isOpenEnded: boolean;
}

/** The claim whose expiry tips free capacity over what the lead needs. */
export interface HbcfFreeingClaim {
  projectId: string;
  label: string;
  claimAmount: number;
  /** `yyyy-MM-dd` */
  freesOn: string;
}

export interface HbcfAssessment {
  totalSumAssured: number;
  /** Held by cover that is live today — lapsed and not-yet-open windows hold nothing. */
  usedAmount: number;
  /** Capacity free right now, before any claim expires. Never negative. */
  directAvailable: number;
  /** Null when the lead has neither a recorded value nor a readable bracket. */
  needRange: HbcfNeedRange | null;
  /** True when `directAvailable` already covers the top of the need range. */
  sufficient: boolean;
  /** Null when capacity is already sufficient, or never becomes sufficient. */
  decisiveClaim: HbcfFreeingClaim | null;
  /** `yyyy-MM-dd`, or null when even freeing every claim falls short. */
  canStartFrom: string | null;
  /** The dashed projection bar on the Gantt. Null when there is nothing to project. */
  projectedWindow: { start: string; end: string } | null;
}

export interface HbcfTimelinePayload {
  claims: HbcfProjectClaim[];
  assessment: HbcfAssessment;
  /** `yyyy-MM-dd` the assessment was computed against. */
  generatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * The short label for a claim. The originating lead's name ("Smith") reads far
 * better in a legend and a Gantt row than the project name, which the offer
 * handoff builds as `clients — site address`.
 */
export function hbcfClaimLabel(claim: HbcfProjectClaim) {
  return claim.leadName?.trim() || claim.projectName;
}

/** Local-midnight parse, so day arithmetic never slips a timezone. */
export function hbcfParseDate(value: string) {
  return parseISO(value);
}

function toIso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/**
 * How long to draw this lead's projected build, derived from the cover windows
 * already on the books rather than guessed. Comparable builds carry comparable
 * cover periods, so their mean is the most defensible number available without
 * product input.
 */
export function hbcfProjectionMonths(claims: readonly HbcfProjectClaim[]) {
  if (claims.length === 0) return HBCF_DEFAULT_PROJECTION_MONTHS;

  const totalDays = claims.reduce(
    (sum, claim) =>
      sum +
      differenceInCalendarDays(
        hbcfParseDate(claim.insuranceClaimEndDate),
        hbcfParseDate(claim.insuranceClaimStartDate),
      ),
    0,
  );

  const months = Math.round(totalDays / claims.length / DAYS_PER_MONTH);
  if (!Number.isFinite(months) || months <= 0) {
    return HBCF_DEFAULT_PROJECTION_MONTHS;
  }

  return Math.min(
    PROJECTION_MONTH_BOUNDS.max,
    Math.max(PROJECTION_MONTH_BOUNDS.min, months),
  );
}

/**
 * The cover this lead would need.
 *
 * Follows the precedence `resolveDealValue` already uses on this screen
 * (components/leads/detail/lead-header.tsx): `estimatedValue` is the source of
 * truth for money and wins when set, widened into a band because cover has to
 * carry variations too. The free-text budget bracket is the fallback — it is
 * already a range, so it is used as-is. Neither present means no defensible
 * number, and the caller drops the assessment rather than inventing one.
 */
export function hbcfNeedRange(lead: {
  estimatedValue?: number | null;
  budget?: string | null;
}): HbcfNeedRange | null {
  const recorded = Number(lead.estimatedValue);
  if (lead.estimatedValue != null && Number.isFinite(recorded) && recorded > 0) {
    return {
      low: Math.round(recorded * (1 - HBCF_NEED_BAND)),
      high: Math.round(recorded * (1 + HBCF_NEED_BAND)),
      source: "estimatedValue",
      isOpenEnded: false,
    };
  }

  const bracket = budgetBracket(lead.budget);
  if (bracket) {
    return {
      low: bracket.min,
      high: bracket.max,
      source: "budgetBracket",
      isOpenEnded: bracket.isOpenEnded,
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*                            Capacity at a moment                            */
/* -------------------------------------------------------------------------- */

/**
 * True when `date` falls inside the claim's cover window, both ends inclusive.
 *
 * Capacity is held for the length of a window and for no longer: a claim that
 * has already lapsed holds nothing, and one whose window has not opened yet is
 * not holding anything today either.
 */
export function hbcfIsActiveOn(claim: HbcfProjectClaim, date: Date) {
  const time = startOfDay(date).getTime();
  return (
    hbcfParseDate(claim.insuranceClaimStartDate).getTime() <= time &&
    time <= hbcfParseDate(claim.insuranceClaimEndDate).getTime()
  );
}

/**
 * Capacity committed at one instant, derived from every claim's actual window.
 *
 * This is deliberately *not* a running total that adds amounts back as windows
 * close. Cover periods overlap, so freeing one claim only helps by as much as
 * the claims still open at that moment leave spare — see `hbcfAssessment`.
 */
function usedAtTime(claims: readonly HbcfProjectClaim[], time: number) {
  return claims.reduce(
    (sum, claim) =>
      hbcfParseDate(claim.insuranceClaimStartDate).getTime() <= time &&
      time <= hbcfParseDate(claim.insuranceClaimEndDate).getTime()
        ? sum + claim.claimAmount
        : sum,
    0,
  );
}

/**
 * Capacity still committed the moment a window closes on `time`: everything
 * whose window covers that day and does *not* end on it.
 */
function usedAfterTime(claims: readonly HbcfProjectClaim[], time: number) {
  return claims.reduce(
    (sum, claim) =>
      hbcfParseDate(claim.insuranceClaimStartDate).getTime() <= time &&
      time < hbcfParseDate(claim.insuranceClaimEndDate).getTime()
        ? sum + claim.claimAmount
        : sum,
    0,
  );
}

/** Whole AUD held by cover that is live on `date`. */
export function hbcfUsedAt(claims: readonly HbcfProjectClaim[], date: Date) {
  return usedAtTime(claims, startOfDay(date).getTime());
}

/* -------------------------------------------------------------------------- */
/*                          Build start assessment                            */
/* -------------------------------------------------------------------------- */

/**
 * Walks the claim expiries to answer "when could this lead start?".
 *
 * The threshold is the *top* of the need range: committing capacity that only
 * covers the optimistic end of the estimate would strand the build halfway
 * through.
 *
 * Cover windows overlap, so the amount a lapsing claim returns is not the
 * amount that becomes usable. Each candidate expiry is therefore scored by
 * re-deriving who is *still* holding cover on that day, never by adding freed
 * amounts onto a running total — a project ending in December frees nothing
 * usable if a second project runs on into February still holding half the pool.
 * The first expiry that leaves enough spare is the single date reported,
 * matching the design's one "nearest freeing up" line rather than a list.
 */
export function hbcfAssessment({
  claims,
  needRange,
  today,
  totalSumAssured = HBCF_TOTAL_SUM_ASSURED,
}: {
  claims: readonly HbcfProjectClaim[];
  needRange: HbcfNeedRange | null;
  today: Date;
  totalSumAssured?: number;
}): HbcfAssessment {
  const nowTime = startOfDay(today).getTime();
  const usedAmount = usedAtTime(claims, nowTime);
  const directAvailable = Math.max(0, totalSumAssured - usedAmount);
  const projectionMonths = hbcfProjectionMonths(claims);

  const base = {
    totalSumAssured,
    usedAmount,
    directAvailable,
    needRange,
  };

  if (!needRange) {
    return {
      ...base,
      sufficient: false,
      decisiveClaim: null,
      canStartFrom: null,
      projectedWindow: null,
    };
  }

  if (directAvailable >= needRange.high) {
    const start = toIso(today);
    return {
      ...base,
      sufficient: true,
      decisiveClaim: null,
      canStartFrom: start,
      projectedWindow: {
        start,
        end: toIso(addMonths(today, projectionMonths)),
      },
    };
  }

  // Every expiry still ahead of us is a candidate date, oldest first. Ties are
  // broken by size so the claim reported as "nearest freeing up" is the most
  // material of the ones closing that day.
  const candidates = [...claims]
    .filter(
      (claim) => hbcfParseDate(claim.insuranceClaimEndDate).getTime() >= nowTime,
    )
    .sort((a, b) => {
      const byEnd =
        hbcfParseDate(a.insuranceClaimEndDate).getTime() -
        hbcfParseDate(b.insuranceClaimEndDate).getTime();
      return byEnd !== 0 ? byEnd : b.claimAmount - a.claimAmount;
    });

  for (const claim of candidates) {
    const endTime = hbcfParseDate(claim.insuranceClaimEndDate).getTime();
    const stillHeld = usedAfterTime(claims, endTime);

    if (totalSumAssured - stillHeld >= needRange.high) {
      const start = claim.insuranceClaimEndDate;
      return {
        ...base,
        sufficient: false,
        decisiveClaim: {
          projectId: claim.projectId,
          label: hbcfClaimLabel(claim),
          claimAmount: claim.claimAmount,
          freesOn: claim.insuranceClaimEndDate,
        },
        canStartFrom: start,
        projectedWindow: {
          start,
          end: toIso(addMonths(hbcfParseDate(start), projectionMonths)),
        },
      };
    }
  }

  // Even the whole pool cannot carry this build — report that plainly rather
  // than picking an arbitrary date.
  return {
    ...base,
    sufficient: false,
    decisiveClaim: null,
    canStartFrom: null,
    projectedWindow: null,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Timeline axis                                 */
/* -------------------------------------------------------------------------- */

/**
 * The span the Gantt has to cover: every claim window, today's marker, and the
 * projected bar if it runs past the last expiry. Snapped out to whole months so
 * the axis starts and ends on a month boundary, with a month of tail padding so
 * the last bar does not finish flush against the edge.
 */
export function hbcfAxisRange({
  claims,
  projectedWindow,
  today,
}: {
  claims: readonly HbcfProjectClaim[];
  projectedWindow: { start: string; end: string } | null;
  today: Date;
}) {
  const starts = claims.map((claim) =>
    hbcfParseDate(claim.insuranceClaimStartDate).getTime(),
  );
  const ends = claims.map((claim) =>
    hbcfParseDate(claim.insuranceClaimEndDate).getTime(),
  );

  if (projectedWindow) {
    starts.push(hbcfParseDate(projectedWindow.start).getTime());
    ends.push(hbcfParseDate(projectedWindow.end).getTime());
  }

  starts.push(today.getTime());
  ends.push(today.getTime());

  return {
    start: startOfMonth(new Date(Math.min(...starts))),
    end: endOfMonth(addMonths(new Date(Math.max(...ends)), 1)),
  };
}
