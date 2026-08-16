# Weighted Pipeline & Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a dollar value and stage-derived likelihood to every lead, and surface weighted pipeline value plus an Australian-FY quarterly forecast on the Leads analytics page.

**Architecture:** All business logic lives in three pure, DB-free modules (`pipeline-stages`, `fy-quarter`, `pipeline-math`) that are fully unit-testable. The data layer fetches rows and hands them to those functions; nothing is cached, because this repo's build must not query the database. Stage probabilities are defined in code rather than a database table, and deal value auto-syncs from the offer's existing contract price rather than being typed a second time.

**Tech Stack:** Next.js 16 (App Router, Cache Components) · Prisma 7.8 on PostgreSQL · Zod 4 · React 19 · Tailwind + shadcn/ui · recharts 3.8 · `node:test` via `tsx` · pnpm

**Spec:** `docs/superpowers/specs/2026-08-16-weighted-pipeline-forecast-design.md`

## Global Constraints

- **Package manager is pnpm.** Never `npm run`. Typecheck: `pnpm typecheck`. Tests: `pnpm test`.
- **Tests use relative imports, not `@/` aliases.** `tsx --test` does not resolve tsconfig `paths`. Import as `../../lib/leads/pipeline-math`. Application code uses `@/` normally.
- **Test glob is `tests/*/*.test.ts` — exactly one directory deep.** `tests/leads/foo.test.ts` is picked up; `tests/foo.test.ts` is not.
- **Test style is `node:test` + `node:assert/strict`.** No Vitest, no Jest, no mocks. Match `tests/offer/contract-particulars.test.ts`.
- **No database in tests.** No test DB exists and the only `DATABASE_URL` points at shared live data. Every test in this plan is a pure-function test.
- **The build must not query the database.** Do NOT add `'use cache'`, `cacheTag`, `cacheLife`, or `unstable_cache` to anything in `lib/data/leads.ts`. Verify with `DATABASE_URL='postgresql://u:p@127.0.0.1:1/db' pnpm build`.
- **Decimal must not cross to a Client Component.** Convert with `.toString()` at the data-layer boundary, per `lib/data/projects.ts:262-264`.
- **Never create `utils/validators.ts`.** Validators live in the directory `utils/validators/`. A file at that path shadows the barrel under `moduleResolution: "bundler"` and breaks all 55 `@/utils/validators` importers.
- **Money type on the client is `string`**, following the `Safe*` convention in `types/offer.ts:18-38`.
- **Timezone for all quarter maths is `Australia/Sydney`.** Never use bare `new Date("YYYY-MM-DD")` for a business date boundary.
- **No exported maths function may return `NaN`.** This is asserted in tests.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `lib/leads/pipeline-stages.ts` | The stage ladder (probability, outcome, banked, colour) + close-date transition rules. Single source of truth for "what does this stage mean". |
| `lib/leads/fy-quarter.ts` | Australian financial-year quarter arithmetic in Sydney time. Self-contained; no lead knowledge. |
| `lib/leads/pipeline-math.ts` | Value coercion, weighting, and the three aggregate computations. Depends on the two above. |
| `scripts/backfill-lead-close-dates.ts` | One-off, idempotent backfill of `wonAt`/`lostAt` from `updatedAt`. |
| `components/leads/pipeline-kpi.tsx` | The four KPI cards. |
| `components/leads/pipeline-stage-chart.tsx` | Horizontal bar per open stage. |
| `components/leads/forecast-panel.tsx` | Quarter figures + FY quarter selector. |
| `tests/leads/pipeline-stages.test.ts` | Ladder totality + transition rules. |
| `tests/leads/fy-quarter.test.ts` | Quarter boundaries, DST, FY rollover. |
| `tests/leads/pipeline-math.test.ts` | Weighting, metrics, forecast, win rate, no-NaN. |

**Modified:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `LeadValueSource` enum + 6 columns and 3 indexes on `Lead`. |
| `lib/data/leads.ts` | `getAnalyticsData` extension, new `getForecast`, close-date stamping in `updateLead`. |
| `lib/data/offers.ts:332` | Close-date stamping on the offer-status → lead-stage path. |
| `lib/data/offer-workspace.ts:409` | Mirror contract value onto the lead. |
| `utils/validators/lead.ts` | New fields on both `createLeadSchema` and `updateLeadSchema`. |
| `lib/leads/types.ts` | New fields on the `Lead` UI interface. |
| `types/lead.ts` | `LeadAnalyticsData` gains `pipelineMetrics` + `forecast`; `mapLead` maps new fields. |
| `hooks/use-leads-data.ts:33` | `useState` initializer gains zeroed new keys. |
| `components/common/metric-card.tsx` | Optional `caption` prop. |
| `components/leads/views/analytics-view.tsx` | Render the three new components. |
| `components/leads/modal-ui/detail-modal.tsx` | "Deal economics" section. |
| `components/leads/modal-ui/add-lead-modal.tsx` | Value + expected close fields. |

---

## Task 1: Stage ladder

**Files:**
- Create: `lib/leads/pipeline-stages.ts`
- Test: `tests/leads/pipeline-stages.test.ts`

**Interfaces:**
- Consumes: `LeadStage` from `@prisma/client`.
- Produces: `StageOutcome`, `PipelineStageDef`, `PIPELINE_STAGES` (a `Record<LeadStage, PipelineStageDef>`), `stageDef(code)`, `isOpenStage(code)`, `closeDatePatch(previous, next, now)`, `CLOSE_DATE_TRACKING_START`, `WIN_RATE_WINDOW_DAYS`.

- [ ] **Step 1: Write the failing test**

Create `tests/leads/pipeline-stages.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOSE_DATE_TRACKING_START,
  PIPELINE_STAGES,
  WIN_RATE_WINDOW_DAYS,
  closeDatePatch,
  isOpenStage,
  stageDef,
} from "../../lib/leads/pipeline-stages";

const ALL_STAGES = [
  "NEW", "CONTACTED", "QUALIFIED", "QUOTED", "NEGOTIATING", "WON", "LOST",
  "MEETING_SCHEDULED", "IN_FOLLOW_UP", "NO_RESPONSE", "CONVERTED",
  "CANCELLED", "DISQUALIFIED",
] as const;

test("every LeadStage has a definition", () => {
  for (const code of ALL_STAGES) {
    const def = stageDef(code);
    assert.ok(def, `missing definition for ${code}`);
    assert.equal(def.code, code);
    assert.ok(def.probability >= 0 && def.probability <= 100);
    assert.ok(def.label.length > 0);
  }
  assert.equal(Object.keys(PIPELINE_STAGES).length, ALL_STAGES.length);
});

test("orders are unique and contiguous from 1", () => {
  const orders = ALL_STAGES.map((c) => stageDef(c).order).sort((a, b) => a - b);
  assert.deepEqual(orders, Array.from({ length: ALL_STAGES.length }, (_, i) => i + 1));
});

test("outcome classification matches the design", () => {
  assert.equal(stageDef("NEGOTIATING").outcome, "OPEN");
  assert.equal(stageDef("WON").outcome, "WON");
  assert.equal(stageDef("CONVERTED").outcome, "WON");
  assert.equal(stageDef("LOST").outcome, "LOST");
  assert.equal(stageDef("CANCELLED").outcome, "LOST");
  assert.equal(stageDef("DISQUALIFIED").outcome, "LOST");
  // NO_RESPONSE is stalled — neither open nor lost.
  assert.equal(stageDef("NO_RESPONSE").outcome, "STALLED");
});

test("banked stages are exactly Negotiating, Won and Converted", () => {
  const banked = ALL_STAGES.filter((c) => stageDef(c).banked).sort();
  assert.deepEqual(banked, ["CONVERTED", "NEGOTIATING", "WON"]);
});

test("isOpenStage excludes stalled and closed stages", () => {
  assert.equal(isOpenStage("QUOTED"), true);
  assert.equal(isOpenStage("NO_RESPONSE"), false);
  assert.equal(isOpenStage("WON"), false);
  assert.equal(isOpenStage("LOST"), false);
});

const NOW = new Date("2026-08-16T02:00:00.000Z");

test("moving to a won stage stamps wonAt and clears lostAt", () => {
  assert.deepEqual(closeDatePatch("NEGOTIATING", "WON", NOW), {
    wonAt: NOW,
    lostAt: null,
  });
});

test("WON to CONVERTED does not re-stamp wonAt", () => {
  assert.deepEqual(closeDatePatch("WON", "CONVERTED", NOW), {});
});

test("moving to a lost stage stamps lostAt and clears wonAt", () => {
  assert.deepEqual(closeDatePatch("QUOTED", "LOST", NOW), {
    wonAt: null,
    lostAt: NOW,
  });
});

test("reopening a closed lead clears both stamps", () => {
  assert.deepEqual(closeDatePatch("WON", "NEGOTIATING", NOW), {
    wonAt: null,
    lostAt: null,
  });
});

test("moving to stalled clears both stamps", () => {
  assert.deepEqual(closeDatePatch("CONTACTED", "NO_RESPONSE", NOW), {
    wonAt: null,
    lostAt: null,
  });
});

test("an unchanged stage produces an empty patch", () => {
  assert.deepEqual(closeDatePatch("QUOTED", "QUOTED", NOW), {});
});

test("a brand new lead in an open stage produces an empty patch", () => {
  assert.deepEqual(closeDatePatch(null, "NEW", NOW), {});
});

test("a lead created directly in a won stage is stamped", () => {
  assert.deepEqual(closeDatePatch(null, "WON", NOW), { wonAt: NOW, lostAt: null });
});

test("tracking constants are sane", () => {
  assert.equal(WIN_RATE_WINDOW_DAYS, 90);
  assert.ok(CLOSE_DATE_TRACKING_START instanceof Date);
  assert.ok(!Number.isNaN(CLOSE_DATE_TRACKING_START.getTime()));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test tests/leads/pipeline-stages.test.ts`
Expected: FAIL — `Cannot find module '../../lib/leads/pipeline-stages'`

- [ ] **Step 3: Write the implementation**

Create `lib/leads/pipeline-stages.ts`:

```ts
import type { LeadStage } from "@prisma/client";

/**
 * What a stage means for pipeline maths.
 * - OPEN    — live deal; counts in open pipeline and weighted pipeline.
 * - WON     — closed successfully; counts in win rate and banked.
 * - LOST    — closed unsuccessfully; counts in win rate only.
 * - STALLED — went quiet without a decision. Counts in NOTHING: it is not a
 *   loss (see lib/data/leads.ts:1091, which already excludes NO_RESPONSE from
 *   lost counts) and it must not inflate open pipeline value.
 */
export type StageOutcome = "OPEN" | "WON" | "LOST" | "STALLED";

export interface PipelineStageDef {
  code: LeadStage;
  label: string;
  /** Display order, 1-based, ascending through the funnel. */
  order: number;
  /** Default likelihood 0-100. Overridable per lead. */
  probability: number;
  outcome: StageOutcome;
  /** Counts toward "Banked this quarter". */
  banked: boolean;
  /** CSS custom property used by the stage chart. */
  colorVar: string;
}

/**
 * Typed as a total Record so that adding a LeadStage enum member without a
 * definition here is a compile error rather than a runtime hole.
 */
export const PIPELINE_STAGES: Record<LeadStage, PipelineStageDef> = {
  NEW:               { code: "NEW",               label: "New",               order: 1,  probability: 10,  outcome: "OPEN",    banked: false, colorVar: "--stage-1" },
  CONTACTED:         { code: "CONTACTED",         label: "Contacted",         order: 2,  probability: 20,  outcome: "OPEN",    banked: false, colorVar: "--stage-2" },
  MEETING_SCHEDULED: { code: "MEETING_SCHEDULED", label: "Meeting Scheduled", order: 3,  probability: 30,  outcome: "OPEN",    banked: false, colorVar: "--stage-3" },
  QUALIFIED:         { code: "QUALIFIED",         label: "Qualified",         order: 4,  probability: 40,  outcome: "OPEN",    banked: false, colorVar: "--stage-4" },
  IN_FOLLOW_UP:      { code: "IN_FOLLOW_UP",      label: "In Follow-up",      order: 5,  probability: 45,  outcome: "OPEN",    banked: false, colorVar: "--stage-5" },
  QUOTED:            { code: "QUOTED",            label: "Quoted",            order: 6,  probability: 55,  outcome: "OPEN",    banked: false, colorVar: "--stage-6" },
  NEGOTIATING:       { code: "NEGOTIATING",       label: "Negotiating",       order: 7,  probability: 70,  outcome: "OPEN",    banked: true,  colorVar: "--stage-7" },
  WON:               { code: "WON",               label: "Won",               order: 8,  probability: 100, outcome: "WON",     banked: true,  colorVar: "--stage-7" },
  CONVERTED:         { code: "CONVERTED",         label: "Converted",         order: 9,  probability: 100, outcome: "WON",     banked: true,  colorVar: "--stage-7" },
  LOST:              { code: "LOST",              label: "Lost",              order: 10, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  CANCELLED:         { code: "CANCELLED",         label: "Cancelled",         order: 11, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  DISQUALIFIED:      { code: "DISQUALIFIED",      label: "Disqualified",      order: 12, probability: 0,   outcome: "LOST",    banked: false, colorVar: "--stage-1" },
  NO_RESPONSE:       { code: "NO_RESPONSE",       label: "No Response",       order: 13, probability: 0,   outcome: "STALLED", banked: false, colorVar: "--stage-1" },
};

export function stageDef(code: LeadStage): PipelineStageDef {
  return PIPELINE_STAGES[code];
}

export function isOpenStage(code: LeadStage): boolean {
  return PIPELINE_STAGES[code].outcome === "OPEN";
}

/** Rolling window for the win-rate card. */
export const WIN_RATE_WINDOW_DAYS = 90;

/**
 * Instant from which wonAt/lostAt are recorded for real. Win-rate windows
 * reaching further back include values approximated by the one-off backfill
 * (scripts/backfill-lead-close-dates.ts) and are flagged in the UI.
 * 2026-08-16 00:00 Sydney (UTC+10).
 */
export const CLOSE_DATE_TRACKING_START = new Date("2026-08-15T14:00:00.000Z");

/**
 * Close-date changes implied by a stage transition.
 *
 * Returns a partial patch — an empty object means "change nothing". Pure, and
 * takes `now` explicitly so it is testable. Called from BOTH lead write paths
 * (lib/data/leads.ts updateLead and lib/data/offers.ts updateOfferStatus);
 * the offer path is how most real wins are recorded.
 */
export function closeDatePatch(
  previous: LeadStage | null,
  next: LeadStage,
  now: Date,
): { wonAt?: Date | null; lostAt?: Date | null } {
  if (previous === next) return {};

  const prevOutcome = previous ? PIPELINE_STAGES[previous].outcome : null;
  const nextOutcome = PIPELINE_STAGES[next].outcome;

  if (nextOutcome === "WON") {
    // WON -> CONVERTED is a move within the won outcome: keep the original date.
    if (prevOutcome === "WON") return {};
    return { wonAt: now, lostAt: null };
  }

  if (nextOutcome === "LOST") {
    if (prevOutcome === "LOST") return {};
    return { wonAt: null, lostAt: now };
  }

  // Moving to OPEN or STALLED. If it was closed, it is no longer a closed
  // deal and must leave the win-rate history.
  if (prevOutcome === "WON" || prevOutcome === "LOST") {
    return { wonAt: null, lostAt: null };
  }
  if (prevOutcome === null) return {};
  // OPEN <-> STALLED: nothing to stamp, but ensure stale stamps are cleared.
  return { wonAt: null, lostAt: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec tsx --test tests/leads/pipeline-stages.test.ts`
Expected: PASS — 13 tests

Note: the "moving to stalled clears both stamps" case goes through the final branch (`CONTACTED` → `NO_RESPONSE`, both non-closed), which returns `{ wonAt: null, lostAt: null }`. That is intentional defensive clearing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add lib/leads/pipeline-stages.ts tests/leads/pipeline-stages.test.ts
git commit -m "feat(leads): stage ladder with probabilities and close-date rules"
```

---

## Task 2: Australian FY quarter arithmetic

**Files:**
- Create: `lib/leads/fy-quarter.ts`
- Test: `tests/leads/fy-quarter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FyQuarter` (`1 | 2 | 3 | 4`), `FyQuarterRef` (`{ fy: number; quarter: FyQuarter }`), `BUSINESS_TZ`, `fyQuarterOf(date)`, `fyQuarterBounds(fy, quarter)` returning `{ start: Date; endExclusive: Date; label: string }`, `formatFyQuarter(fy, quarter)`.

Australian FY2027 = 1 Jul 2026 → 30 Jun 2027. Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun.

- [ ] **Step 1: Write the failing test**

Create `tests/leads/fy-quarter.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fyQuarterBounds,
  fyQuarterOf,
  formatFyQuarter,
} from "../../lib/leads/fy-quarter";

test("August 2026 is FY2027 Q1", () => {
  assert.deepEqual(fyQuarterOf(new Date("2026-08-16T02:00:00.000Z")), {
    fy: 2027,
    quarter: 1,
  });
});

test("each FY quarter classifies its months", () => {
  // Sydney is UTC+10/+11, so use midday UTC to stay inside the same local day.
  assert.deepEqual(fyQuarterOf(new Date("2026-07-15T02:00:00Z")), { fy: 2027, quarter: 1 });
  assert.deepEqual(fyQuarterOf(new Date("2026-11-15T02:00:00Z")), { fy: 2027, quarter: 2 });
  assert.deepEqual(fyQuarterOf(new Date("2027-02-15T02:00:00Z")), { fy: 2027, quarter: 3 });
  assert.deepEqual(fyQuarterOf(new Date("2027-05-15T02:00:00Z")), { fy: 2027, quarter: 4 });
});

test("the financial year rolls over on 1 July, Sydney time", () => {
  // 30 Jun 2026 23:00 Sydney == 2026-06-30T13:00Z -> still FY2026 Q4
  assert.deepEqual(fyQuarterOf(new Date("2026-06-30T13:00:00Z")), { fy: 2026, quarter: 4 });
  // 1 Jul 2026 00:30 Sydney == 2026-06-30T14:30Z -> FY2027 Q1
  assert.deepEqual(fyQuarterOf(new Date("2026-06-30T14:30:00Z")), { fy: 2027, quarter: 1 });
});

test("FY2027 Q1 starts at Sydney midnight on 1 July 2026", () => {
  const { start, endExclusive, label } = fyQuarterBounds(2027, 1);
  // 1 Jul 2026 00:00 AEST (UTC+10) == 2026-06-30T14:00Z
  assert.equal(start.toISOString(), "2026-06-30T14:00:00.000Z");
  // 1 Oct 2026 00:00 AEST (UTC+10, DST starts first Sunday of October = 4 Oct)
  assert.equal(endExclusive.toISOString(), "2026-09-30T14:00:00.000Z");
  assert.equal(label, "FY2027 Q1");
});

test("bounds are half-open and contiguous across the year", () => {
  const quarters = [1, 2, 3, 4] as const;
  for (let i = 0; i < quarters.length - 1; i++) {
    const a = fyQuarterBounds(2027, quarters[i]);
    const b = fyQuarterBounds(2027, quarters[i + 1]);
    assert.equal(a.endExclusive.getTime(), b.start.getTime(), `gap after Q${quarters[i]}`);
  }
  // Q4 of FY2027 ends where Q1 of FY2028 starts.
  assert.equal(
    fyQuarterBounds(2027, 4).endExclusive.getTime(),
    fyQuarterBounds(2028, 1).start.getTime(),
  );
});

test("a deal at 23:59 on the last local day of a quarter is inside it", () => {
  const { start, endExclusive } = fyQuarterBounds(2027, 1);
  // 30 Sep 2026 23:59 Sydney == 2026-09-30T13:59Z
  const lastMoment = new Date("2026-09-30T13:59:00Z");
  assert.ok(lastMoment >= start && lastMoment < endExclusive);
});

test("a deal at midnight on the first local day of the next quarter is outside", () => {
  const { endExclusive } = fyQuarterBounds(2027, 1);
  const firstOfNext = new Date("2026-09-30T14:00:00Z");
  assert.ok(firstOfNext >= endExclusive);
});

test("quarter bounds survive the Sydney DST transitions", () => {
  // DST starts first Sunday of October, ends first Sunday of April.
  // Q2 FY2027 (Oct-Dec 2026) starts before DST, ends inside it.
  const q2 = fyQuarterBounds(2027, 2);
  assert.equal(q2.start.toISOString(), "2026-09-30T14:00:00.000Z"); // AEST +10
  assert.equal(q2.endExclusive.toISOString(), "2026-12-31T13:00:00.000Z"); // AEDT +11
  // Q4 FY2027 (Apr-Jun 2027) starts during DST's final days.
  const q4 = fyQuarterBounds(2027, 4);
  assert.equal(q4.start.toISOString(), "2027-03-31T13:00:00.000Z"); // AEDT +11
  assert.equal(q4.endExclusive.toISOString(), "2027-06-30T14:00:00.000Z"); // AEST +10
});

test("round trip: every quarter's own start classifies back to itself", () => {
  for (const fy of [2026, 2027, 2028]) {
    for (const q of [1, 2, 3, 4] as const) {
      const { start } = fyQuarterBounds(fy, q);
      assert.deepEqual(fyQuarterOf(start), { fy, quarter: q }, `FY${fy} Q${q}`);
    }
  }
});

test("formatFyQuarter renders the display label", () => {
  assert.equal(formatFyQuarter(2027, 1), "FY2027 Q1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test tests/leads/fy-quarter.test.ts`
Expected: FAIL — `Cannot find module '../../lib/leads/fy-quarter'`

- [ ] **Step 3: Write the implementation**

Create `lib/leads/fy-quarter.ts`:

```ts
/**
 * Australian financial-year quarter arithmetic, in Sydney local time.
 *
 * FY2027 runs 1 Jul 2026 - 30 Jun 2027.
 *   Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun.
 *
 * All bounds are HALF-OPEN instants: [start, endExclusive). This is why there
 * is no month-length table anywhere in this file, and why a deal closing at
 * any time on a quarter's last local day is correctly inside it.
 */

export const BUSINESS_TZ = "Australia/Sydney";

export type FyQuarter = 1 | 2 | 3 | 4;

export interface FyQuarterRef {
  fy: number;
  quarter: FyQuarter;
}

export interface FyQuarterBounds {
  start: Date;
  endExclusive: Date;
  label: string;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Sydney wall-clock reading at a given instant. */
function wallClockAt(instant: Date): WallClock {
  const parts = PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Intl can emit hour 24 for midnight under hour12:false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Sydney's UTC offset, in ms, at a given instant. */
function offsetMsAt(instant: Date): number {
  const wc = wallClockAt(instant);
  const asIfUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which Sydney's wall clock reads midnight on the given date.
 * Two-pass because the offset itself depends on the instant we are solving
 * for — the first guess can land on the wrong side of a DST transition.
 */
function sydneyMidnight(year: number, month: number, day: number): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = naiveUtc - offsetMsAt(new Date(naiveUtc));
  const secondPass = naiveUtc - offsetMsAt(new Date(firstPass));
  return new Date(secondPass);
}

/** Calendar year and month (1-12) on which a given FY quarter begins. */
function quarterStartMonth(fy: number, quarter: FyQuarter): { year: number; month: number } {
  switch (quarter) {
    case 1: return { year: fy - 1, month: 7 };
    case 2: return { year: fy - 1, month: 10 };
    case 3: return { year: fy, month: 1 };
    case 4: return { year: fy, month: 4 };
  }
}

export function formatFyQuarter(fy: number, quarter: FyQuarter): string {
  return `FY${fy} Q${quarter}`;
}

export function fyQuarterBounds(fy: number, quarter: FyQuarter): FyQuarterBounds {
  const from = quarterStartMonth(fy, quarter);
  const next =
    quarter === 4
      ? quarterStartMonth(fy + 1, 1)
      : quarterStartMonth(fy, (quarter + 1) as FyQuarter);

  return {
    start: sydneyMidnight(from.year, from.month, 1),
    endExclusive: sydneyMidnight(next.year, next.month, 1),
    label: formatFyQuarter(fy, quarter),
  };
}

/** Which FY quarter an instant falls in, judged by Sydney local time. */
export function fyQuarterOf(instant: Date): FyQuarterRef {
  const { year, month } = wallClockAt(instant);
  if (month >= 7 && month <= 9) return { fy: year + 1, quarter: 1 };
  if (month >= 10) return { fy: year + 1, quarter: 2 };
  if (month <= 3) return { fy: year, quarter: 3 };
  return { fy: year, quarter: 4 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec tsx --test tests/leads/fy-quarter.test.ts`
Expected: PASS — 10 tests

If the DST assertions fail, print the actual ISO strings and check them against a Sydney timezone converter before changing the implementation. Do **not** "fix" the test by relaxing it to a range — these boundaries are the point of the module.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add lib/leads/fy-quarter.ts tests/leads/fy-quarter.test.ts
git commit -m "feat(leads): Australian FY quarter bounds in Sydney time"
```

---

## Task 3: Value coercion and weighting

**Files:**
- Create: `lib/leads/pipeline-math.ts`
- Test: `tests/leads/pipeline-math.test.ts`

**Interfaces:**
- Consumes: `stageDef` from Task 1; `Prisma` from `@prisma/client`.
- Produces: `LeadForMetrics` interface, `ZERO`, `coerceMoney(value)` returning `Prisma.Decimal | null`, `probabilityFor(lead)` returning `number`, `weightedValueOf(lead)` returning `Prisma.Decimal`.

`coerceMoney` is the guard for every documented failure mode: `new Prisma.Decimal("")` and `new Prisma.Decimal("abc")` **throw** rather than producing NaN, and money arrives from JSON as a string.

- [ ] **Step 1: Write the failing test**

Create `tests/leads/pipeline-math.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";

import {
  coerceMoney,
  probabilityFor,
  weightedValueOf,
  type LeadForMetrics,
} from "../../lib/leads/pipeline-math";

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
  assert.equal(probabilityFor(lead({ stage: "NEGOTIATING" })), 70);
  assert.equal(probabilityFor(lead({ stage: "NEW" })), 10);
  assert.equal(probabilityFor(lead({ stage: "WON" })), 100);
});

test("probabilityFor honours an explicit override", () => {
  assert.equal(probabilityFor(lead({ stage: "NEW", probabilityOverride: 85 })), 85);
  assert.equal(probabilityFor(lead({ stage: "NEGOTIATING", probabilityOverride: 0 })), 0);
});

test("probabilityFor clamps and rounds, and survives NaN", () => {
  assert.equal(probabilityFor(lead({ probabilityOverride: 150 })), 100);
  assert.equal(probabilityFor(lead({ probabilityOverride: -20 })), 0);
  assert.equal(probabilityFor(lead({ probabilityOverride: 79.6 })), 80);
  // Math.trunc(NaN) is NaN and survives a clamp — must fall back to the stage.
  assert.equal(probabilityFor(lead({ stage: "QUOTED", probabilityOverride: Number.NaN })), 55);
});

test("weightedValueOf multiplies value by probability", () => {
  assert.equal(
    weightedValueOf(lead({ stage: "NEGOTIATING", estimatedValue: "842150" })).toString(),
    "589505",
  );
  assert.equal(
    weightedValueOf(lead({ stage: "NEW", estimatedValue: "620000" })).toString(),
    "62000",
  );
});

test("weightedValueOf rounds to two decimal places", () => {
  assert.equal(
    weightedValueOf(lead({ stage: "IN_FOLLOW_UP", estimatedValue: "1" })).toString(),
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
  assert.equal(result.toString(), "55");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test tests/leads/pipeline-math.test.ts`
Expected: FAIL — `Cannot find module '../../lib/leads/pipeline-math'`

- [ ] **Step 3: Write the implementation**

Create `lib/leads/pipeline-math.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { LeadStage } from "@prisma/client";

import { stageDef } from "./pipeline-stages";

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
    if (parsed.isNaN() || !parsed.isFinite() || parsed.isNegative()) return null;
    return parsed;
  } catch {
    return null;
  }
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
  const fallback = stageDef(lead.stage).probability;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec tsx --test tests/leads/pipeline-math.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add lib/leads/pipeline-math.ts tests/leads/pipeline-math.test.ts
git commit -m "feat(leads): defensive money coercion and probability weighting"
```

---

## Task 4: Aggregates — metrics, forecast, win rate

**Files:**
- Modify: `lib/leads/pipeline-math.ts` (append)
- Test: `tests/leads/pipeline-math.test.ts` (append)

**Interfaces:**
- Consumes: `LeadForMetrics`, `coerceMoney`, `probabilityFor`, `weightedValueOf`, `ZERO` (Task 3); `stageDef`, `isOpenStage`, `WIN_RATE_WINDOW_DAYS`, `CLOSE_DATE_TRACKING_START` (Task 1); `fyQuarterBounds`, `fyQuarterOf`, `FyQuarter` (Task 2).
- Produces: `StageBucket`, `WinRate`, `PipelineMetrics`, `ForecastResult`, `computeWinRate(leads, from, to)`, `computePipelineMetrics(leads, now)`, `computeForecast(leads, fy, quarter)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/leads/pipeline-math.test.ts`:

```ts
import {
  computeForecast,
  computePipelineMetrics,
  computeWinRate,
} from "../../lib/leads/pipeline-math";

const NOW = new Date("2026-08-16T02:00:00.000Z"); // FY2027 Q1

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
  assert.equal(metrics.weightedValue.toString(), "55000");
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
  assert.equal(newBucket.weighted.toString(), "40000");
  assert.equal(negotiating.weighted.toString(), "140000");
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

test("computeForecast splits expected, weighted, won and banked", () => {
  const forecast = computeForecast(
    [
      // Won this quarter, full value.
      lead({ id: 1, stage: "WON", estimatedValue: "1240000", expectedCloseDate: "2026-08-01T00:00:00Z", wonAt: "2026-08-01T00:00:00Z" }),
      // Negotiating this quarter — banked, weighted at 70%.
      lead({ id: 2, stage: "NEGOTIATING", estimatedValue: "842150", expectedCloseDate: "2026-09-12T00:00:00Z" }),
      // Quoted this quarter — weighted at 55%, NOT banked.
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
  assert.equal(forecast.bankedValue.toString(), "2082150"); // won + negotiating
  // 1240000*1.0 + 842150*0.7 + 400000*0.55 = 1240000 + 589505 + 220000
  assert.equal(forecast.weightedValue.toString(), "2049505");
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

test("win rate flags estimated dates for windows reaching before tracking began", () => {
  const metrics = computePipelineMetrics([], NOW);
  assert.equal(metrics.winRate.estimatedDates, true);
  assert.equal(metrics.winRate.windowDays, 90);

  const later = computePipelineMetrics([], new Date("2027-01-01T00:00:00Z"));
  assert.equal(later.winRate.estimatedDates, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test tests/leads/pipeline-math.test.ts`
Expected: FAIL — `computePipelineMetrics is not a function` (or an import error)

- [ ] **Step 3: Write the implementation**

Append to `lib/leads/pipeline-math.ts`.

**First, merge the imports.** Task 3 already wrote `import { stageDef } from "./pipeline-stages";` at the top of this file. Do not add a second import statement from the same module — `eslint no-duplicate-imports` will flag it. Widen the existing line in place to:

```ts
import {
  CLOSE_DATE_TRACKING_START,
  WIN_RATE_WINDOW_DAYS,
  isOpenStage,
  stageDef,
} from "./pipeline-stages";
```

and add one new import line:

```ts
import { fyQuarterBounds, type FyQuarter } from "./fy-quarter";
```

Then append the implementation:

```ts

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
  /** The same deals, probability-weighted. Won deals sit at 100%, so they
   *  contribute in full through the ordinary path — no special case. */
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

  const windowStart = new Date(now.getTime() - WIN_RATE_WINDOW_DAYS * MS_PER_DAY);

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec tsx --test tests/leads/pipeline-math.test.ts`
Expected: PASS — 23 tests total in this file

- [ ] **Step 5: Run the whole suite and commit**

```bash
pnpm test
pnpm typecheck
git add lib/leads/pipeline-math.ts tests/leads/pipeline-math.test.ts
git commit -m "feat(leads): pipeline metrics, FY forecast and win rate"
```

---

## Task 5: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: `LeadValueSource` enum (`OFFER` | `MANUAL`); `Lead.estimatedValue`, `Lead.estimatedValueSource`, `Lead.probabilityOverride`, `Lead.expectedCloseDate`, `Lead.wonAt`, `Lead.lostAt`.

No test — schema changes are verified by `prisma validate` and `pnpm typecheck`.

- [ ] **Step 1: Add the enum**

In `prisma/schema.prisma`, alongside the other enums (near `LeadStage` at line 56):

```prisma
enum LeadValueSource {
  OFFER
  MANUAL
}
```

- [ ] **Step 2: Add the columns**

Inside `model Lead` (currently around line 522), before the closing brace and alongside the existing `@@index` lines:

```prisma
  // ── Deal economics ────────────────────────────────────────────────
  /// Numeric deal value. Auto-filled from the active offer's contract
  /// price unless estimatedValueSource is MANUAL. `budget` remains a
  /// free-text note and is NOT the source of truth.
  estimatedValue       Decimal?         @db.Decimal(14, 2)
  estimatedValueSource LeadValueSource?
  /// Null means "inherit the stage default" (lib/leads/pipeline-stages.ts).
  /// Never default this to 0 — that would read as 0% for every lead.
  probabilityOverride  Int?
  expectedCloseDate    DateTime?
  wonAt                DateTime?
  lostAt               DateTime?

  @@index([expectedCloseDate])
  @@index([wonAt])
  @@index([lostAt])
```

- [ ] **Step 3: Validate the schema**

Run: `pnpm exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 4: Create the migration**

Run: `pnpm exec prisma migrate dev --name add_lead_deal_economics`

Expected: a new directory under `prisma/migrations/` whose `migration.sql` contains `CREATE TYPE "LeadValueSource"`, six `ALTER TABLE "Lead" ADD COLUMN`, and three `CREATE INDEX`. All columns nullable, so no data backfill is required to apply it.

If no database is reachable, generate SQL only with `pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` and hand-author the migration directory following the existing naming convention (`<14-digit UTC timestamp>_<snake_case>`).

- [ ] **Step 5: Regenerate the client, typecheck and commit**

```bash
pnpm exec prisma generate
pnpm typecheck
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(leads): add deal economics columns to Lead"
```

---

## Task 6: Close-date backfill script

**Files:**
- Create: `scripts/backfill-lead-close-dates.ts`

**Interfaces:**
- Consumes: `stageDef` (Task 1); the Prisma client from `lib/prisma`.
- Produces: a runnable script; no exports consumed elsewhere.

Follows the repo convention for one-off scripts — a plain `tsx` entry point, like `scripts/seed-admin-offer-content.ts`.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-lead-close-dates.ts`:

```ts
/**
 * One-off: approximate wonAt/lostAt for leads that closed before close-date
 * tracking began, using updatedAt.
 *
 * updatedAt is a POOR proxy — any edit bumps it — so results are flagged in
 * the UI via CLOSE_DATE_TRACKING_START. This is a deliberate one-time
 * approximation so the win-rate card has history on launch day, not an
 * ongoing mechanism.
 *
 * Idempotent: only writes where the target column is still null, so re-runs
 * change nothing.
 *
 * Run: pnpm exec tsx scripts/backfill-lead-close-dates.ts
 */
import { PIPELINE_STAGES } from "../lib/leads/pipeline-stages";
import { prisma } from "../lib/prisma";

const WON_STAGES = Object.values(PIPELINE_STAGES)
  .filter((s) => s.outcome === "WON")
  .map((s) => s.code);

const LOST_STAGES = Object.values(PIPELINE_STAGES)
  .filter((s) => s.outcome === "LOST")
  .map((s) => s.code);

async function main() {
  console.log("Backfilling lead close dates…");
  console.log(`  won stages:  ${WON_STAGES.join(", ")}`);
  console.log(`  lost stages: ${LOST_STAGES.join(", ")}`);

  const wonCandidates = await prisma.lead.findMany({
    where: { stage: { in: WON_STAGES }, wonAt: null },
    select: { id: true, updatedAt: true },
  });
  for (const lead of wonCandidates) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { wonAt: lead.updatedAt },
    });
  }

  const lostCandidates = await prisma.lead.findMany({
    where: { stage: { in: LOST_STAGES }, lostAt: null },
    select: { id: true, updatedAt: true },
  });
  for (const lead of lostCandidates) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lostAt: lead.updatedAt },
    });
  }

  console.log(`  stamped ${wonCandidates.length} won, ${lostCandidates.length} lost`);
  console.log("Done. Re-running is safe — it will report 0, 0.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

If `lib/prisma` does not export a named `prisma`, check its actual export shape first (`grep -n "export" lib/prisma.ts`) and match it.

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, alongside `seed:projects` and `seed:tradies`:

```json
"backfill:lead-close-dates": "tsx scripts/backfill-lead-close-dates.ts"
```

Note: this repo configures `prisma db seed` in `prisma.config.ts`, **not** a package.json `"prisma"` key. This is a plain tsx script and does not touch that config.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add scripts/backfill-lead-close-dates.ts package.json
git commit -m "feat(leads): one-off backfill for lead close dates"
```

Run it against a real database only when deploying — it writes to live data.

---

## Task 7: Stage-transition stamping

**Files:**
- Modify: `lib/data/leads.ts` (in `updateLead`, around line 868)
- Modify: `lib/data/offers.ts` (in `updateOfferStatus`, around lines 328-338)

**Interfaces:**
- Consumes: `closeDatePatch` (Task 1).
- Produces: no new exports — behaviour change only.

**This is the highest-risk task in the plan.** `lib/data/offers.ts:332-334` performs a nested `lead: { update: { stage } }` driven by `OFFER_TO_LEAD_STATUS_UPDATE_MAP` (line 244), which maps `ACCEPTED`/`AGREED`/`TENDER_*`/`CONTRACT_*`/`PROJECT` → `WON`. That is how most real wins are recorded. Stamping only in `updateLead` would leave the forecast blind to them.

- [ ] **Step 1: Read both call sites before editing**

```bash
sed -n '860,910p' lib/data/leads.ts
sed -n '240,270p;320,345p' lib/data/offers.ts
```

Confirm the exact shape of each update before changing it — line numbers drift.

- [ ] **Step 2: Stamp in `updateLead`**

In `lib/data/leads.ts`, inside `updateLead`, the existing code maps an incoming stage to `updateData.stage`. The current stage must be read before the update to know the previous value. Add, after the stage-mapping block and before the `prisma.lead.update` call:

```ts
import { closeDatePatch } from "@/lib/leads/pipeline-stages";

// … inside updateLead, after updateData.stage has been resolved:
if (updateData.stage !== undefined) {
  const current = await prisma.lead.findUnique({
    where: { id },
    select: { stage: true },
  });
  Object.assign(
    updateData,
    closeDatePatch(current?.stage ?? null, updateData.stage, new Date()),
  );
}
```

If `updateLead` already fetches the existing lead, reuse that read instead of adding a second query.

- [ ] **Step 3: Stamp on the offer-status path**

In `lib/data/offers.ts`, the nested write at ~line 332 looks like:

```ts
lead: {
  update: {
    stage: OFFER_TO_LEAD_STATUS_UPDATE_MAP[status],
  },
},
```

Change it to compute the patch from the lead's current stage. The surrounding function must have the lead's current stage in scope; if it does not, select it alongside whatever the offer query already loads:

```ts
import { closeDatePatch } from "@/lib/leads/pipeline-stages";

const nextStage = OFFER_TO_LEAD_STATUS_UPDATE_MAP[status];
// … where `offer.lead.stage` is the lead's current stage:
lead: {
  update: {
    stage: nextStage,
    ...closeDatePatch(offer.lead?.stage ?? null, nextStage, new Date()),
  },
},
```

- [ ] **Step 4: Verify by inspection**

There is no DB test harness, so verify statically:

```bash
grep -n "closeDatePatch" lib/data/leads.ts lib/data/offers.ts
```

Expected: at least one hit in each file. Then:

```bash
pnpm typecheck
```

Expected: clean. A type error here usually means `stage` is typed as the UI string union rather than the Prisma `LeadStage` enum — map it before calling.

- [ ] **Step 5: Commit**

```bash
git add lib/data/leads.ts lib/data/offers.ts
git commit -m "feat(leads): stamp wonAt/lostAt on both stage-change paths"
```

---

## Task 8: Offer value sync

**Files:**
- Modify: `lib/data/offer-workspace.ts` (around line 409)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — behaviour change only.

- [ ] **Step 1: Read the write site**

```bash
sed -n '385,420p' lib/data/offer-workspace.ts
grep -n "leadId\|lead:" lib/data/offer-workspace.ts | head -20
```

Line 409 currently writes `contractValueIncGst: contractValue` on the offer.

- [ ] **Step 2: Mirror the value onto the lead**

After the offer write, inside the same transaction if one is in scope:

```ts
// Keep the lead's deal value in step with the quoted contract price, unless
// someone has typed their own figure. Offer.contractValueIncGst is the
// authoritative number once an offer exists; a second hand-typed field would
// only ever disagree with it.
if (offer.leadId && contractValue.greaterThan(0)) {
  await tx.lead.updateMany({
    where: {
      id: offer.leadId,
      // updateMany + this filter means a MANUAL lead is skipped atomically,
      // with no read-then-write race.
      NOT: { estimatedValueSource: "MANUAL" },
    },
    data: {
      estimatedValue: contractValue,
      estimatedValueSource: "OFFER",
    },
  });
}
```

Adjust `tx` to whatever the surrounding transaction client is named; if there is no transaction, use `prisma.lead.updateMany`.

Two rules from the design:
- Only the **active** (non-superseded) offer may write. If this code path can run for a superseded revision, guard with the offer's `isActive` flag.
- A null or zero contract value must **not** null the lead's existing value — hence the `greaterThan(0)` guard.

- [ ] **Step 3: Verify**

```bash
grep -n "estimatedValueSource" lib/data/offer-workspace.ts
pnpm typecheck
```

Expected: one hit; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add lib/data/offer-workspace.ts
git commit -m "feat(leads): sync lead deal value from the offer contract price"
```

---

## Task 9: Data layer

**Files:**
- Modify: `lib/data/leads.ts` (`getAnalyticsData` around line 1163; new `getForecast`)

**Interfaces:**
- Consumes: `computePipelineMetrics`, `computeForecast`, `LeadForMetrics` (Tasks 3-4); `fyQuarterOf` (Task 2).
- Produces: `getForecast(fy: number, quarter: FyQuarter)` returning a serialisable forecast; `getAnalyticsData` return gains `pipelineMetrics` and `forecast`.

**Do not add any caching directive.** `lib/data/leads.ts` is a `"use server"` module with no caching primitives, and it must stay that way — a `'use cache'` fetcher prefills at `next build` and fails CI with `ETIMEDOUT`.

- [ ] **Step 1: Add the shared fetch and serialisation helpers**

In `lib/data/leads.ts`:

```ts
import {
  computeForecast,
  computePipelineMetrics,
  type LeadForMetrics,
  type PipelineMetrics,
  type ForecastResult,
} from "@/lib/leads/pipeline-math";
import { fyQuarterOf, type FyQuarter } from "@/lib/leads/fy-quarter";

const PIPELINE_SELECT = {
  id: true,
  stage: true,
  estimatedValue: true,
  probabilityOverride: true,
  expectedCloseDate: true,
  wonAt: true,
  lostAt: true,
} as const;

async function fetchLeadsForMetrics(): Promise<LeadForMetrics[]> {
  // isArchived filter matches every other lead aggregate in the app
  // (see lib/data/leads.ts:1094, :1137). Soft-deleted leads must not
  // inflate pipeline value.
  const rows = await prisma.lead.findMany({
    where: { isArchived: false },
    select: PIPELINE_SELECT,
  });
  return rows.map((row) => ({
    ...row,
    estimatedValue: row.estimatedValue?.toString() ?? null,
  }));
}

/** Decimal cannot cross to a Client Component — stringify at the boundary. */
function serializeMetrics(metrics: PipelineMetrics) {
  return {
    ...metrics,
    totalValue: metrics.totalValue.toString(),
    weightedValue: metrics.weightedValue.toString(),
    byStage: metrics.byStage.map((bucket) => ({
      ...bucket,
      total: bucket.total.toString(),
      weighted: bucket.weighted.toString(),
    })),
  };
}

function serializeForecast(forecast: ForecastResult) {
  return {
    ...forecast,
    expectedValue: forecast.expectedValue.toString(),
    weightedValue: forecast.weightedValue.toString(),
    wonValue: forecast.wonValue.toString(),
    bankedValue: forecast.bankedValue.toString(),
  };
}

export type SafePipelineMetrics = ReturnType<typeof serializeMetrics>;
export type SafeForecast = ReturnType<typeof serializeForecast>;
```

- [ ] **Step 2: Add `getForecast`**

```ts
export async function getForecast(
  fy: number,
  quarter: FyQuarter,
): Promise<SafeForecast> {
  const leads = await fetchLeadsForMetrics();
  return serializeForecast(computeForecast(leads, fy, quarter));
}
```

- [ ] **Step 3: Extend `getAnalyticsData`**

Inside `getAnalyticsData` (line ~1163), before the return:

```ts
const now = new Date();
const leadsForMetrics = await fetchLeadsForMetrics();
const current = fyQuarterOf(now);
const pipelineMetrics = serializeMetrics(computePipelineMetrics(leadsForMetrics, now));
const forecast = serializeForecast(computeForecast(leadsForMetrics, current.fy, current.quarter));
```

and add `pipelineMetrics` and `forecast` to the returned object.

- [ ] **Step 4: Verify no caching crept in**

```bash
grep -nE "use cache|cacheTag|cacheLife|unstable_cache" lib/data/leads.ts
```

Expected: **no output.** Any hit is a build-breaking regression.

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add lib/data/leads.ts
git commit -m "feat(leads): expose pipeline metrics and forecast from the data layer"
```

---

## Task 10: Validation and shared types

**Files:**
- Modify: `utils/validators/lead.ts` (`updateLeadSchema` at line 179, `createLeadSchema` at line 232)
- Modify: `lib/leads/types.ts` (the `Lead` interface at line 86)
- Modify: `types/lead.ts` (`LeadAnalyticsData` at ~line 163, `mapLead` at line 89)
- Modify: `hooks/use-leads-data.ts` (the `useState` initializer at lines 33-38)

**Interfaces:**
- Consumes: `SafePipelineMetrics`, `SafeForecast` (Task 9).
- Produces: validated request fields; `Lead` UI type gains the new fields; `LeadAnalyticsData` gains `pipelineMetrics` and `forecast`.

- [ ] **Step 1: Extend BOTH Zod schemas**

`createLeadSchema` and `updateLeadSchema` are **independent object literals** — `updateLeadSchema` is not `.partial()`-derived. `PATCH /api/(data)/leads/[leadId]` parses against `updateLeadSchema` (route line 17), and Zod 4 strips unknown keys silently, so editing only one makes the field vanish with no error.

Add to **both**:

```ts
  estimatedValue: z
    .union([z.number(), z.string()])
    .nullable()
    .optional()
    .describe("Numeric deal value"),
  probabilityOverride: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("Likelihood override 0-100; null inherits the stage default"),
  expectedCloseDate: nullableDateInput
    .describe("Expected close date")
    .optional(),
```

`nullableDateInput` already exists at `utils/validators/lead.ts:76` and is what `meetingDate` (line 201) and `followupDate` (line 208) use. Do **not** reach for `z.iso.datetime()` — it rejects date-only strings, which is what a date input emits.

- [ ] **Step 2: Extend the UI Lead type**

In `lib/leads/types.ts`, add to the `Lead` interface. Money is `string` on the client, per the `Safe*` convention in `types/offer.ts:18-38`:

```ts
  estimatedValue?: string | null;
  estimatedValueSource?: "OFFER" | "MANUAL" | null;
  probabilityOverride?: number | null;
  expectedCloseDate?: string | null;
```

- [ ] **Step 3: Map the new fields**

`mapLead` in `types/lead.ts:89` is an explicit field-by-field whitelist with no spread — new Prisma columns do **not** flow through automatically. Add each field explicitly, converting Decimal with `.toString()`.

- [ ] **Step 4: Extend `LeadAnalyticsData`**

In `types/lead.ts`:

```ts
import type { SafeForecast, SafePipelineMetrics } from "@/lib/data/leads";

export interface LeadAnalyticsData {
  // … existing four keys …
  pipelineMetrics: SafePipelineMetrics;
  forecast: SafeForecast;
}
```

- [ ] **Step 5: Fix the useState initializer**

`hooks/use-leads-data.ts:33-38` hard-codes a full `LeadAnalyticsData` literal with four empty arrays. A non-optional new key breaks it. Add zeroed values:

```ts
  pipelineMetrics: {
    openCount: 0,
    valuedCount: 0,
    invalidValueCount: 0,
    totalValue: "0",
    weightedValue: "0",
    byStage: [],
    winRate: { percent: null, won: 0, lost: 0, windowDays: 90, estimatedDates: false },
  },
  forecast: {
    fy: 0, quarter: 1, label: "", start: "", endExclusive: "",
    dealCount: 0, expectedValue: "0", weightedValue: "0",
    wonValue: "0", bankedValue: "0",
  },
```

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
```

Expected: clean. This step is where a missed call site surfaces — fix any reported location rather than loosening a type to `any`.

```bash
git add utils/validators/lead.ts lib/leads/types.ts types/lead.ts hooks/use-leads-data.ts
git commit -m "feat(leads): validation and types for deal economics"
```

---

## Task 11: KPI cards

**Files:**
- Modify: `components/common/metric-card.tsx`
- Create: `components/leads/pipeline-kpi.tsx`

**Interfaces:**
- Consumes: `SafePipelineMetrics`, `SafeForecast` (Task 9); `MetricCard` and `MetricTone` from `components/common/metric-card`.
- Produces: `<PipelineKpi metrics={…} forecast={…} />`.

- [ ] **Step 1: Add the optional caption to MetricCard**

In `components/common/metric-card.tsx`, add `caption?: string` to `MetricCardProps` and render it under the title:

```tsx
        <div className="min-w-0">
          <p className="font-heading text-2xl font-semibold leading-none tracking-tight text-foreground">
            {displayValue}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{title}</p>
          {caption ? (
            <p className="mt-0.5 truncate font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {caption}
            </p>
          ) : null}
        </div>
```

Purely additive — existing call sites are untouched.

- [ ] **Step 2: Build PipelineKpi**

Create `components/leads/pipeline-kpi.tsx`:

```tsx
"use client";

import { BarChart3, CalendarCheck, CheckCircle2, Scale } from "lucide-react";

import { MetricCard } from "@/components/common/metric-card";
import type { SafeForecast, SafePipelineMetrics } from "@/lib/data/leads";

interface PipelineKpiProps {
  metrics: SafePipelineMetrics;
  forecast: SafeForecast;
}

export function PipelineKpi({ metrics, forecast }: PipelineKpiProps) {
  const { winRate } = metrics;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Open Pipeline Value"
          value={metrics.totalValue}
          isCurrency
          Icon={BarChart3}
          tone="accent"
        />
        <MetricCard
          title="Weighted Pipeline"
          value={metrics.weightedValue}
          isCurrency
          Icon={Scale}
          tone="primary"
        />
        <MetricCard
          title={`Win Rate (${winRate.windowDays} days)`}
          value={winRate.percent === null ? "—" : `${winRate.percent}%`}
          caption={`${winRate.won} won · ${winRate.lost} lost`}
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          title={`Banked · ${forecast.label}`}
          value={forecast.bankedValue}
          isCurrency
          Icon={CalendarCheck}
          tone="info"
        />
      </div>

      {winRate.estimatedDates ? (
        <p className="px-0.5 text-[11.5px] text-muted-foreground">
          Win rate counts decisions, not dollars. It includes estimated close
          dates for deals settled before tracking began — accurate from here on,
          and this note clears itself once the window passes.
        </p>
      ) : null}
    </div>
  );
}
```

`MetricCard` renders `—` for a non-finite currency value already (line 73), and passing the string `"—"` with `isCurrency` omitted renders it verbatim.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add components/common/metric-card.tsx components/leads/pipeline-kpi.tsx
git commit -m "feat(leads): pipeline KPI cards"
```

---

## Task 12: Stage chart, forecast panel and wiring

**Files:**
- Create: `components/leads/pipeline-stage-chart.tsx`
- Create: `components/leads/forecast-panel.tsx`
- Modify: `components/leads/views/analytics-view.tsx`
- Modify: `app/globals.css` (stage colour tokens)

**Interfaces:**
- Consumes: `SafePipelineMetrics`, `SafeForecast` (Task 9); `getForecast` (Task 9); `formatFyQuarter` (Task 2).
- Produces: `<PipelineStageChart metrics={…} />`, `<ForecastPanel forecast={…} />`.

- [ ] **Step 1: Add the stage colour tokens**

In `app/globals.css`, in the `:root` block near the existing `--royal-*` tokens, add the ramp the stage definitions reference. It runs cool-grey → gold as likelihood rises, then green for banked stages:

```css
  --stage-1: oklch(0.74 0.025 253);
  --stage-2: oklch(0.78 0.055 88);
  --stage-3: oklch(0.762 0.085 84);
  --stage-4: oklch(0.735 0.105 80);
  --stage-5: oklch(0.715 0.115 78);
  --stage-6: oklch(0.694 0.12 77.3);
  --stage-7: oklch(0.627 0.17 149.2);
```

Add dark-mode values in the existing `.dark` / dark block:

```css
  --stage-1: oklch(0.5 0.02 253);
  --stage-2: oklch(0.55 0.05 88);
  --stage-3: oklch(0.585 0.07 84);
  --stage-4: oklch(0.61 0.09 80);
  --stage-5: oklch(0.63 0.1 78);
  --stage-6: oklch(0.66 0.115 77.3);
  --stage-7: oklch(0.62 0.15 149.2);
```

- [ ] **Step 2: Build the stage chart**

Create `components/leads/pipeline-stage-chart.tsx`. **Bar length encodes face value; the filled portion encodes the weighted share**, so the empty remainder is literally the probability discount. This is deliberately not two side-by-side bars.

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { compactCurrency } from "@/utils/formatters";
import type { SafePipelineMetrics } from "@/lib/data/leads";

interface PipelineStageChartProps {
  metrics: SafePipelineMetrics;
}

export function PipelineStageChart({ metrics }: PipelineStageChartProps) {
  const maxTotal = metrics.byStage.reduce(
    (max, bucket) => Math.max(max, Number(bucket.total)),
    0,
  );

  if (metrics.byStage.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Where the money sits</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No open leads with a deal value yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base">Where the money sits</CardTitle>
        <span className="text-[11.5px] text-muted-foreground">Open leads only</span>
      </CardHeader>
      <CardContent className="flex flex-col">
        {metrics.byStage.map((bucket) => {
          const total = Number(bucket.total);
          const barWidth = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
          return (
            <div key={bucket.code} className="flex flex-col gap-1.5 border-t border-dashed border-border py-2.5 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[12.5px] font-semibold">{bucket.label}</span>
                <span className="rounded bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground">
                  {bucket.probability}%
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {bucket.count} {bucket.count === 1 ? "lead" : "leads"}
                </span>
                <span className="ml-auto font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  <b className="font-medium text-foreground">
                    {compactCurrency.format(total)}
                  </b>{" "}
                  → {compactCurrency.format(Number(bucket.weighted))}
                </span>
              </div>
              <div
                className="h-3.5 overflow-hidden rounded-sm bg-border/55"
                style={{ width: `${barWidth}%` }}
                role="img"
                aria-label={`${bucket.label}: ${compactCurrency.format(total)} face value, ${compactCurrency.format(Number(bucket.weighted))} weighted`}
              >
                <div
                  className="h-full rounded-l-sm"
                  style={{
                    width: `${bucket.probability}%`,
                    background: `var(${bucket.colorVar})`,
                  }}
                />
              </div>
            </div>
          );
        })}

        <div className="mt-3 flex flex-wrap justify-between gap-3 border-t-2 border-foreground pt-3 text-[12.5px]">
          <span>{metrics.openCount} open leads</span>
          <span className="font-mono tabular-nums">
            Face {compactCurrency.format(Number(metrics.totalValue))} → Weighted{" "}
            {compactCurrency.format(Number(metrics.weightedValue))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Build the forecast panel**

Create `components/leads/forecast-panel.tsx`, with a quarter selector that calls `getForecast`:

```tsx
"use client";

import { useState, useTransition } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getForecast } from "@/lib/data/leads";
import type { SafeForecast } from "@/lib/data/leads";
import type { FyQuarter } from "@/lib/leads/fy-quarter";
import { compactCurrency } from "@/utils/formatters";

const QUARTERS: { q: FyQuarter; label: string }[] = [
  { q: 1, label: "Q1 Jul–Sep" },
  { q: 2, label: "Q2 Oct–Dec" },
  { q: 3, label: "Q3 Jan–Mar" },
  { q: 4, label: "Q4 Apr–Jun" },
];

export function ForecastPanel({ forecast: initial }: { forecast: SafeForecast }) {
  const [forecast, setForecast] = useState(initial);
  const [pending, startTransition] = useTransition();

  function select(quarter: FyQuarter) {
    startTransition(async () => {
      setForecast(await getForecast(forecast.fy, quarter));
    });
  }

  const rows = [
    { label: "Expected to close", sub: `${forecast.dealCount} deals with a close date this quarter`, value: forecast.expectedValue },
    { label: "Weighted", sub: "Discounted by stage likelihood", value: forecast.weightedValue },
    { label: "Already won", sub: "Signed this quarter", value: forecast.wonValue },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base">{forecast.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-1 rounded-md border border-border bg-muted p-0.5">
          {QUARTERS.map(({ q, label }) => (
            <button
              key={q}
              type="button"
              onClick={() => select(q)}
              aria-pressed={forecast.quarter === q}
              disabled={pending}
              className="rounded px-2.5 py-1 text-xs font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm disabled:opacity-60"
            >
              {label}
            </button>
          ))}
        </div>

        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0">
            <span className="text-[12.5px]">
              {row.label}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.sub}</span>
            </span>
            <span className="whitespace-nowrap font-mono text-sm tabular-nums">
              {compactCurrency.format(Number(row.value))}
            </span>
          </div>
        ))}

        <div className="mt-3 rounded-md border border-success-ink bg-success-light p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold">Banked</span>
            <span className="font-heading text-xl font-semibold tabular-nums">
              {compactCurrency.format(Number(forecast.bankedValue))}
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Won plus deals in negotiation. Quoted and earlier excluded.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

If `bg-success-light` / `border-success-ink` are not registered Tailwind utilities in this project, use inline `style={{ background: "var(--success-light)" }}` instead — check `app/globals.css` `@theme` for which tokens are exposed as utilities.

- [ ] **Step 4: Wire into the analytics view**

In `components/leads/views/analytics-view.tsx`, import the three components and render them: `<PipelineKpi>` above the existing `analytics-summary` block, and a two-column row with `<PipelineStageChart>` and `<ForecastPanel>` after the existing chart rows.

```tsx
<PipelineKpi metrics={analytics.pipelineMetrics} forecast={analytics.forecast} />
{/* … existing rows … */}
<div className="analytics-row">
  <PipelineStageChart metrics={analytics.pipelineMetrics} />
  <ForecastPanel forecast={analytics.forecast} />
</div>
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm lint
```

Then confirm the build does not touch the database:

```bash
DATABASE_URL='postgresql://u:p@127.0.0.1:1/db' pnpm build
```

Expected: reaches "Generating static pages (N/N)", exit 0, zero `prisma:error` lines.

```bash
git add app/globals.css components/leads/pipeline-stage-chart.tsx components/leads/forecast-panel.tsx components/leads/views/analytics-view.tsx
git commit -m "feat(leads): stage chart and FY forecast panel"
```

---

## Task 13: Deal economics in the lead modal

**Files:**
- Modify: `components/leads/modal-ui/detail-modal.tsx`
- Modify: `components/leads/modal-ui/add-lead-modal.tsx`

**Interfaces:**
- Consumes: the `Lead` UI type (Task 10); `stageDef` (Task 1); `fyQuarterOf`, `formatFyQuarter` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Read the existing form conventions**

```bash
sed -n '280,300p;470,515p' components/leads/modal-ui/detail-modal.tsx
```

Note `inputCls` (line ~290) and `labelCls` (line ~292), the existing `<input type="date">` at ~504, and the Budget `<select>` at ~478-491. Reuse these exactly — there is no shared date-picker or currency-input component, and the repo uses plain native inputs here.

- [ ] **Step 2: Add the Deal economics section**

Insert after the Budget field in `detail-modal.tsx`. The value input shows its provenance and switches to manual on edit:

```tsx
<div className="col-span-2">
  <label className={labelCls} htmlFor="estimatedValue">Deal value</label>
  <div className="flex items-center gap-2">
    <input
      id="estimatedValue"
      type="number"
      min={0}
      step={1000}
      className={inputCls}
      value={form.estimatedValue ?? ""}
      onChange={(e) =>
        setForm({
          ...form,
          estimatedValue: e.target.value,
          estimatedValueSource: "MANUAL",
        })
      }
    />
    {form.estimatedValueSource === "OFFER" ? (
      <span className="whitespace-nowrap rounded-full bg-[var(--info-light)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--info-ink)]">
        From offer
      </span>
    ) : null}
  </div>
  {form.estimatedValueSource === "MANUAL" ? (
    <button
      type="button"
      className="mt-1 text-[11px] underline"
      onClick={() => setForm({ ...form, estimatedValueSource: null })}
    >
      Follow the offer price again
    </button>
  ) : (
    <span className="mt-1 block text-[11px] text-muted-foreground">
      Follows the quoted contract price.
    </span>
  )}
</div>

<div>
  <label className={labelCls} htmlFor="probabilityOverride">Likelihood</label>
  <input
    id="probabilityOverride"
    type="number"
    min={0}
    max={100}
    className={inputCls}
    placeholder={String(stageDef(form.stage).probability)}
    value={form.probabilityOverride ?? ""}
    onChange={(e) =>
      setForm({
        ...form,
        probabilityOverride: e.target.value === "" ? null : Number(e.target.value),
      })
    }
  />
  <span className="mt-1 block text-[11px] text-muted-foreground">
    {stageDef(form.stage).label} default is {stageDef(form.stage).probability}%
  </span>
</div>

<div>
  <label className={labelCls} htmlFor="expectedCloseDate">Expected close</label>
  <input
    id="expectedCloseDate"
    type="date"
    className={inputCls}
    value={form.expectedCloseDate ?? ""}
    onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
  />
</div>
```

Leaving the likelihood input empty means "inherit the stage default" — that is why the stage default is the **placeholder**, not the value. Never write the stage default into the field as a real value; that would silently convert every lead to an override.

- [ ] **Step 3: Relabel Budget**

Change the Budget field's label from `Budget` to `Budget discussed — rough note` so it reads as context rather than a competing figure.

- [ ] **Step 4: Add the two fields to add-lead-modal**

In `add-lead-modal.tsx`, add deal value and expected close only, following the `fieldCls` / `itemLbl` conventions at lines ~236 and ~241. Likelihood follows the stage at creation, so no override input.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm lint
```

```bash
git add components/leads/modal-ui/detail-modal.tsx components/leads/modal-ui/add-lead-modal.tsx
git commit -m "feat(leads): deal economics fields on the lead modals"
```

---

## Final verification

- [ ] **All tests pass**

```bash
pnpm test
```

Expected: green, including all no-NaN assertions.

- [ ] **Typecheck clean**

```bash
pnpm typecheck
```

The baseline before this work was clean, so any error is new.

- [ ] **Build does not query the database**

```bash
DATABASE_URL='postgresql://u:p@127.0.0.1:1/db' pnpm build
```

Expected: reaches "Generating static pages (N/N)", exit 0, zero `prisma:error`.

- [ ] **No caching directives in the leads data layer**

```bash
grep -nE "use cache|cacheTag|cacheLife|unstable_cache" lib/data/leads.ts
```

Expected: no output.

- [ ] **Both stage-change paths stamp close dates**

```bash
grep -n "closeDatePatch" lib/data/leads.ts lib/data/offers.ts
```

Expected: a hit in each file.

- [ ] **Spec acceptance criteria** — walk section 13 of the design doc and confirm each item.

---

## Notes for the executor

- **CI does not run tests.** It runs lint, typecheck and build with a deliberately unreachable `DATABASE_URL`. Green CI does not mean the suite passed — run `pnpm test` locally.
- **Do not create a test database or point tests at `DATABASE_URL`.** The only connection string available holds real leads. Every test in this plan is a pure-function test by design.
- **If a line number in this plan does not match**, search for the named symbol instead. The plan was written against the tree at commit `7cb0332`.
- **Do not add a `PipelineStage` database table.** It was considered and rejected in the design; the ladder lives in code precisely so there is no second source of truth and no unlinked-lead bug class.
