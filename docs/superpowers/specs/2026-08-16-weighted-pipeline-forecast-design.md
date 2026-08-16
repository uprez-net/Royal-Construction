# Weighted Pipeline & Forecast — Design

**Date:** 2026-08-16
**Branch:** `feat/weighted-pipeline-forecast`
**Status:** Approved for implementation

Supersedes `docs/SALES_PIPELINE_KPI_PROBABILITY_SPEC.md`, which was reviewed on 2026-08-15 and found to contain several defects that would ship a broken feature. Section 12 lists what changed and why.

---

## 1. Purpose

Leads today carry a stage but no money. You can count leads; you cannot answer "how much work is coming, and when?"

This attaches a dollar value and a likelihood to each lead, then aggregates them into a weighted pipeline figure and a quarterly forecast.

The core idea: a $620,000 job at Negotiating (70%) is worth $434,000 of expected revenue; the same job at New (10%) is worth $62,000. Summing raw pipeline value overstates reality; summing weighted value does not.

**In scope:** four KPI cards, a by-stage breakdown, an FY-quarter forecast panel, and deal-economics fields on the lead edit modal.

**Out of scope (deferred):** the Kanban pipeline board, admin-editable stage probabilities, multi-currency and FX, DB-backed integration tests.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where deal value comes from | Auto-filled from the linked offer's contract price; manual entry before an offer exists | `Offer.contractValueIncGst` is already the authoritative number. A hand-typed parallel field would be a fourth money field that can silently disagree. |
| Stage probabilities | Defined in code, not a database table | Removes a migration, a seed, a backfill, and a second source of truth. Also removes the unlinked-lead bug class (see §12). Admin-editable table remains possible later without changing the maths. |
| Quarters | Australian financial year (Q1 = Jul–Sep) | Matches BAS, tax year and how the business already reports. |
| "Banked" | Won + Converted + Negotiating | The spec's `>= 80%` rule was unreachable — no open stage reached 80, so banked was identical to won. Naming stages is explicit and cannot silently collapse. |
| Win rate window | Rolling 90 days | At ~2–3 closes/month a 30-day window swings 30+ points on one deal. |
| Win rate basis | Deal count, not dollars | Measures conversion, which is the card's job. Deal size is covered by the cards beside it. |
| No Response | Its own "stalled" outcome | Existing aggregates (`lib/data/leads.ts:1091`) already refuse to count it as lost; calling it lost here would contradict the conversion figure on the same screen. Leaving it open would let dead leads inflate the pipeline. |
| Weighted value storage | Computed on read, never stored | The original spec both cached it and recomputed it — two numbers that drift. |
| Currency | None. AUD only | The app is single-currency by construction (every formatter pins en-AU/AUD, NSW GST, HBCF). |

---

## 3. Stage ladder

New module `lib/leads/pipeline-stages.ts`. One entry per existing `LeadStage` enum member — all 13 covered, no new enum values.

```ts
export type StageOutcome = "OPEN" | "WON" | "LOST" | "STALLED";

export interface PipelineStageDef {
  code: LeadStage;
  label: string;
  order: number;          // display order, ascending
  probability: number;    // 0-100, the stage default
  outcome: StageOutcome;
  banked: boolean;        // counts toward "Banked this quarter"
  colorVar: string;       // CSS custom property name
}
```

| order | code | label | probability | outcome | banked |
|---|---|---|---|---|---|
| 1 | `NEW` | New | 10 | OPEN | no |
| 2 | `CONTACTED` | Contacted | 20 | OPEN | no |
| 3 | `MEETING_SCHEDULED` | Meeting Scheduled | 30 | OPEN | no |
| 4 | `QUALIFIED` | Qualified | 40 | OPEN | no |
| 5 | `IN_FOLLOW_UP` | In Follow-up | 45 | OPEN | no |
| 6 | `QUOTED` | Quoted | 55 | OPEN | no |
| 7 | `NEGOTIATING` | Negotiating | 70 | OPEN | **yes** |
| 8 | `WON` | Won | 100 | WON | **yes** |
| 9 | `CONVERTED` | Converted | 100 | WON | **yes** |
| 10 | `LOST` | Lost | 0 | LOST | no |
| 11 | `CANCELLED` | Cancelled | 0 | LOST | no |
| 12 | `DISQUALIFIED` | Disqualified | 0 | LOST | no |
| 13 | `NO_RESPONSE` | No Response | 0 | **STALLED** | no |

The module must export a lookup that is total over `LeadStage` — a `Record<LeadStage, PipelineStageDef>` so adding an enum member without a definition is a compile error, not a runtime hole.

**Outcome semantics:**

- `OPEN` — counts in open pipeline and weighted pipeline.
- `WON` / `LOST` — excluded from open pipeline; included in win rate.
- `STALLED` — excluded from **both**. Not a loss, not live.

---

## 4. Schema changes

Single migration: `add_lead_deal_economics`.

```prisma
enum LeadValueSource {
  OFFER
  MANUAL
}
```

Added to `model Lead` (currently `prisma/schema.prisma:522-585`):

```prisma
  estimatedValue       Decimal?         @db.Decimal(14, 2)
  estimatedValueSource LeadValueSource?
  probabilityOverride  Int?
  expectedCloseDate    DateTime?
  wonAt                DateTime?
  lostAt               DateTime?

  @@index([expectedCloseDate])
  @@index([wonAt])
  @@index([lostAt])
```

Notes:

- **`probabilityOverride` is null by default**, meaning "inherit the stage default". This is what makes existing leads work immediately with no probability backfill — an untouched Negotiating lead reads 70%, not 0%.
- **No `weightedValue` column.** Computed on read (§6).
- **No `currency` column.**
- **No `stageId` / `PipelineStage` table.** The existing `stage: LeadStage` enum remains the single stage field.
- `budget: String?` is unchanged and stays a free-text note.

### 4a. Backfill

One script, `scripts/backfill-lead-close-dates.ts`, idempotent (only writes where the target column is null):

- `stage` outcome `WON` → `wonAt = updatedAt`
- `stage` outcome `LOST` → `lostAt = updatedAt`
- everything else → untouched

`updatedAt` is a poor proxy — any edit bumps it — so this is a one-off approximation, not an ongoing mechanism. It is fenced by a constant:

```ts
// lib/leads/pipeline-stages.ts
export const CLOSE_DATE_TRACKING_START = new Date("2026-08-16T00:00:00+10:00");
```

Win-rate results whose window begins before this instant carry `estimatedDates: true`, and the UI shows a caveat. Roughly 90 days after launch the flag turns itself off with no code change.

`estimatedValue` is **not** backfilled by this script — it is populated by the offer sync (§5), which runs against real quoted prices.

---

## 5. Value sync from the offer

`Offer.contractValueIncGst` (`prisma/schema.prisma:647`) is written on every offer-workspace save at `lib/data/offer-workspace.ts:409`.

**Rule:** when an offer's contract value is persisted, mirror it onto the linked lead unless that lead's value is manually owned.

```
if (lead.estimatedValueSource !== "MANUAL") {
  lead.estimatedValue = <active offer>.contractValueIncGst
  lead.estimatedValueSource = "OFFER"
}
```

- **Which offer:** the lead's active (non-superseded) offer. Offers form a revision family (`baseReference` / `revisionNumber` / `isActive` / `supersededById`); a superseded revision must not overwrite the lead's value.
- **Manual override:** when a user types a value in the modal, set `estimatedValueSource = "MANUAL"`. That lead stops syncing. The modal offers a control to hand it back to automatic, which clears the source and re-pulls from the offer.
- **Null contract value:** if the active offer has no usable contract value, leave the lead's existing value alone rather than nulling it. `lib/offer/offer-contract-value.ts:21-46` already derives a value from `workspaceState` when the stored column is 0/null — reuse it rather than duplicating the logic.

This sync belongs in the offer-workspace write path, not in a Prisma middleware, so it stays greppable and testable.

---

## 6. Stage transitions and close timestamps

`stage` is written from several places. The two that matter for forecasting are:

1. `lib/data/leads.ts:868` — `updateLead`, the modal path.
2. `lib/data/offers.ts:332-334` — `updateOfferStatus`, a nested `lead: { update: { stage } }` driven by `OFFER_TO_LEAD_STATUS_UPDATE_MAP` (`lib/data/offers.ts:244`). This maps `ACCEPTED`/`AGREED`/`TENDER_*`/`CONTRACT_*`/`PROJECT` → `WON`.

**The second path is the one most wins actually travel through.** If only `updateLead` stamps `wonAt`, the forecast ignores nearly every real win.

Both call one shared pure helper:

```ts
// lib/leads/pipeline-stages.ts
export function closeDatePatch(
  previous: LeadStage | null,
  next: LeadStage,
  now: Date,
): { wonAt?: Date | null; lostAt?: Date | null }
```

Rules:

| Transition | Effect |
|---|---|
| → a `WON` stage, `wonAt` already set | no change (WON → CONVERTED must not re-stamp) |
| → a `WON` stage, `wonAt` null | `wonAt = now`, `lostAt = null` |
| → a `LOST` stage | `lostAt = now`, `wonAt = null` |
| → an `OPEN` or `STALLED` stage | `wonAt = null`, `lostAt = null` (reopened deal leaves the win-rate history) |
| stage unchanged | empty patch |

The helper is pure and takes `now` explicitly so it is unit-testable.

Other `stage` writers (`app/api/graph/notifications/route.ts:385` inbound-email lead creation, the follow-up cron paths) create or move leads only among OPEN stages, so they need no change — but the helper is cheap enough to apply at any future call site.

---

## 7. Calculation module

New module `lib/leads/pipeline-math.ts`. Pure functions, no database access, no ambient clock — every function that needs the current time takes `now: Date` as a parameter.

```ts
export function probabilityFor(lead: LeadForMetrics): number;
export function weightedValueOf(lead: LeadForMetrics): Decimal;

export function fyQuarterOf(date: Date): { fy: number; quarter: 1 | 2 | 3 | 4 };
export function fyQuarterBounds(fy: number, quarter: 1 | 2 | 3 | 4):
  { start: Date; endExclusive: Date; label: string };

export function computePipelineMetrics(leads: LeadForMetrics[], now: Date): PipelineMetrics;
export function computeForecast(leads: LeadForMetrics[], fy: number, quarter: 1|2|3|4, now: Date): ForecastResult;
export function computeWinRate(leads: LeadForMetrics[], from: Date, to: Date): WinRate;
```

### 7a. Probability and weighting

```
probability = clamp(round(probabilityOverride ?? stage.probability), 0, 100)
weighted    = value × probability / 100, rounded to 2dp, ROUND_HALF_UP
```

### 7b. Financial-year quarters

FY2027 runs 1 Jul 2026 – 30 Jun 2027. Q1 = Jul–Sep, Q2 = Oct–Dec, Q3 = Jan–Mar, Q4 = Apr–Jun.

- A date in month ≥ July belongs to FY `year + 1`; otherwise FY `year`.
- **Timezone is `Australia/Sydney`.** Bounds are local-midnight instants converted to UTC. A deal expected 1 Jul 2026 Sydney is stored `2026-06-30T14:00Z` and must land in FY2027 Q1, not FY2026 Q4.
- **Bounds are half-open:** `start <= expectedCloseDate < endExclusive`, where `endExclusive` is the start of the next quarter. This removes month-length arithmetic entirely and correctly includes deals closing at any time on the quarter's last day.
- Display label: `FY2027 Q1`.

### 7c. Win rate

```
percent = won / (won + lost) × 100
```

over leads whose `wonAt` or `lostAt` falls in `[from, to)`. Default window is 90 days ending at `now`.

- Denominator zero → `percent: null`. The UI renders `—`, never `0%` and never `NaN%`.
- Returns `{ percent, won, lost, windowDays, estimatedDates }` so the card can show its sample size.
- `estimatedDates` is true when `from < CLOSE_DATE_TRACKING_START`.
- `STALLED` leads are excluded from both numerator and denominator.

### 7d. Numeric hardening

These are requirements, not suggestions — each corresponds to a verified failure in the superseded spec:

- Values arrive over JSON as strings. `new Prisma.Decimal("")` and `new Prisma.Decimal("abc")` **throw** — they do not produce NaN. Parse defensively and treat unparseable input as *absent*, not zero.
- `Math.trunc(NaN)` is `NaN` and survives a `Math.max`/`Math.min` clamp, and `Decimal.add(NaN)` poisons the entire sum. Guard with `Number.isFinite` before clamping.
- **No exported function may return a NaN Decimal or a NaN number.** Assert this in tests.
- Negative or unparseable values are excluded from sums and counted in `invalidValueCount` so bad data is visible rather than silently netted off.
- Use `Math.round`, not `Math.trunc`, when normalising a probability.

### 7e. Result shapes

```ts
interface PipelineMetrics {
  openCount: number;
  valuedCount: number;        // open leads with a usable value
  invalidValueCount: number;
  totalValue: Decimal;        // face value, open leads
  weightedValue: Decimal;     // probability-weighted, open leads
  byStage: Array<{
    code: LeadStage; label: string; order: number; colorVar: string;
    probability: number; count: number; total: Decimal; weighted: Decimal;
  }>;
  winRate: WinRate;
}

interface ForecastResult {
  fy: number; quarter: 1 | 2 | 3 | 4; label: string;
  start: string; endExclusive: string;   // ISO
  dealCount: number;
  expectedValue: Decimal;   // face value of deals closing in the window
  weightedValue: Decimal;   // the same deals, probability-weighted
  wonValue: Decimal;        // already-won deals in the window
  bankedValue: Decimal;     // wonValue + open deals in banked stages
}
```

`ForecastResult.weightedValue` is strictly the probability-weighted figure — it does **not** add won deals at full value. Won deals sit at 100% probability, so they contribute their full value through the ordinary weighting path with no special case. This is deliberate: in the superseded spec two different quantities were both called `weightedValue` and rendered side by side.

---

## 8. Data layer

All in `lib/data/leads.ts` (a `"use server"` module — see §11 on caching).

1. `getAnalyticsData()` (`lib/data/leads.ts:1163`) gains `pipelineMetrics` and `forecast` (current FY quarter) on its return.
2. New `getForecast(fy: number, quarter: 1|2|3|4)` server action, for the quarter picker.
3. Both filter `isArchived = false`, matching every other lead aggregate in the app (`lib/data/leads.ts:1094`, `:1137`, `lib/data/dashboard.ts:95`). Soft-deleted leads must not inflate pipeline value.
4. Fetch via `prisma.lead.findMany` with an explicit `select` of only the fields the maths needs. Decimal columns are converted with `.toString()` at the data-layer boundary, following the existing convention (`lib/data/projects.ts:262-264`) — a raw Decimal crossing to a Client Component throws.

**No new API route handlers.** The analytics view already reaches `getAnalyticsData` through a server action; the quarter picker uses the same channel.

---

## 9. UI

### 9a. New components

- `components/leads/pipeline-kpi.tsx` — four `MetricCard`s: Open Pipeline Value, Weighted Pipeline, Win Rate (90 days), Banked This Quarter.
- `components/leads/pipeline-stage-chart.tsx` — one horizontal bar per open stage. **Bar length encodes face value; the filled portion encodes the weighted share.** The unfilled remainder is the probability discount, so the chart shows why the number is what it is. Banked stages use the success colour.
- `components/leads/forecast-panel.tsx` — expected / weighted / won / banked for the selected quarter, with an FY-quarter selector defaulting to the current quarter.

### 9b. Shared component change

`components/common/metric-card.tsx` gains one optional prop:

```ts
caption?: string;   // small line under the title
```

Used only by the win-rate card, to show `6 won · 4 lost`. Over 90 days a percentage without its sample size is unreadable. This is additive; existing call sites are untouched.

The estimated-dates caveat sits **below** the card row, not inside a card — it will not fit the card's fixed three-column grid, and it is temporary.

### 9c. Wiring

- `components/leads/views/analytics-view.tsx` renders `PipelineKpi` above the existing charts and the stage chart + forecast panel below them.
- `types/lead.ts` — extend `LeadAnalyticsData` with `pipelineMetrics` and `forecast`.
- `hooks/use-leads-data.ts:33-38` — the `useState<LeadAnalyticsData>` initializer is a full object literal and **must** gain zeroed values for the new keys or it will not typecheck.
- `lib/leads/types.ts:86` — extend the `Lead` interface with the new fields (money as `string`, per the `Safe*` convention in `types/offer.ts:18-38`).

### 9d. Lead edit modal

`components/leads/modal-ui/detail-modal.tsx` gains a "Deal economics" section:

- **Deal value** — shows provenance ("From Offer #1042") when auto-filled; typing switches it to manual, with a control to revert to automatic.
- **Likelihood** — the stage default, with the stage named as the hint; editing sets `probabilityOverride`.
- **Expected close** — date input, with the FY quarter it lands in shown as a hint.
- **Budget** — the existing 5-option dropdown, relabelled as a rough note.
- A computed read-out: `$842,150 × 70% = $589,505`.

`components/leads/modal-ui/add-lead-modal.tsx` gets deal value and expected close only; likelihood follows the stage at creation.

### 9e. Validation

Extend **both** `createLeadSchema` (`utils/validators/lead.ts:232`) and `updateLeadSchema` (`utils/validators/lead.ts:179`). They are independent object literals, not `.partial()`-derived, and `PATCH` parses against `updateLeadSchema` (`app/api/(data)/leads/[leadId]/route.ts:17`). Zod v4 strips unknown keys silently, so editing only one would make the field vanish with no error.

- `estimatedValue` — optional, non-negative, ≤ 14 digits.
- `probabilityOverride` — optional integer 0–100, nullable.
- `expectedCloseDate` — reuse the existing `nullableDateInput` preprocessor (`utils/validators/lead.ts:76`). Do **not** use `z.iso.datetime()`, which rejects date-only strings.

> Do not create a file at `utils/validators.ts`. Validators live in the directory `utils/validators/`; under `moduleResolution: "bundler"` a sibling file at that path shadows the barrel and breaks all 55 `@/utils/validators` importers.

---

## 10. Testing

`tests/leads/pipeline-math.test.ts`, using `node:test` + `node:assert/strict` like the rest of the suite. The `pnpm test` glob is `tests/*/*.test.ts` — exactly one directory deep, so this path is picked up.

Required cases:

- Weighting: normal, null value, string value, unparseable string, negative value, override vs stage default, probability out of range.
- **No exported function returns NaN** under any of the above.
- FY quarters: month-boundary classification, Sydney-local midnight, a deal on the last day of a quarter at 23:59 local (must be included), a deal at 00:00 on the first day of the next quarter (must be excluded), FY rollover at 1 July.
- Metrics: open-only filtering, STALLED excluded, archived excluded, by-stage grouping, empty pipeline yields zeros not NaN.
- Forecast: banked = won + Negotiating; deals outside the window excluded; won deals contribute once, not twice.
- Win rate: normal, zero denominator → null, STALLED excluded, `estimatedDates` flag flips on the cutoff.
- `closeDatePatch`: each row of the §6 table, including WON → CONVERTED not re-stamping.

**No DB-backed integration test.** There is no test database: no test env file, no docker-compose, no in-memory Prisma, and the only `DATABASE_URL` points at a shared Neon instance holding real leads. Building that infrastructure is a separate task, not part of this PR. The design pushes all logic into pure functions specifically so this limitation does not reduce coverage of the parts that can be wrong.

---

## 11. Constraints to respect

- **The build must not query the database.** Under `cacheComponents: true`, a `'use cache'` fetcher called in a page body prefills at `next build` and fails CI with `ETIMEDOUT`. `lib/data/leads.ts` currently has no caching primitives; the new fetchers must stay uncached. Do **not** add a `getCachedPipelineMetrics` wrapper following `lib/data/projects.ts:593`. Verify with `DATABASE_URL='postgresql://u:p@127.0.0.1:1/db' pnpm build`.
- **CI runs lint, typecheck and build — not tests.** Green CI does not mean the suite ran. Run `pnpm test` locally.
- Decimal values must be `.toString()`-converted before crossing to a Client Component.

---

## 12. Changes from the superseded spec

Each item below is a verified defect in `docs/SALES_PIPELINE_KPI_PROBABILITY_SPEC.md`, not a matter of taste.

| # | Defect | Resolution |
|---|---|---|
| 1 | `committedValue` = open deals ≥ 80% + won, but no open stage reached 80 (max: Negotiating at 70). The KPI card duplicated the won figure exactly. | Banked is defined by naming stages, not by a threshold. |
| 2 | `wonAt` / `lostAt` referenced in three places, added in none. Zero occurrences repo-wide. | Both columns added (§4), stamped by a shared helper (§6). |
| 3 | `updatedAt` proposed as a win-date fallback. Won leads receive far more post-close writes than lost ones, biasing win rate upward over time. | Real timestamps; `updatedAt` used only for a fenced one-off backfill. |
| 4 | `Offer.contractValueIncGst` never mentioned, so `estimatedValue` duplicated an authoritative number and stayed blank at exactly the stages where a real price exists. | Value auto-syncs from the offer (§5). |
| 5 | Weighted value both cached in a column and recomputed on read. | Computed only. |
| 6 | Date-only quarter bounds compared against a `DateTime`; deals on a quarter's last day with a time component were dropped, and every AU quarter boundary misassigned 10–11 hours of revenue. | Half-open instant bounds in `Australia/Sydney` (§7b). |
| 7 | `Math.trunc(NaN)` survives the clamp; one NaN probability turns every total into NaN. | `Number.isFinite` guard; no-NaN assertion in tests. |
| 8 | `new Prisma.Decimal("")` throws — the `isNaN()` guard was dead code for string input, which is the JSON wire format. | Defensive parsing; unparseable treated as absent. |
| 9 | `Decimal(0).div(0)` is NaN — an empty 30-day window rendered `NaN%`. | Zero denominator returns null; UI shows `—`. |
| 10 | `PipelineMetrics.weightedValue` and `ForecastResult.weightedValue` were different quantities with the same name, rendered side by side. | Forecast exposes `expectedValue` / `weightedValue` / `wonValue` / `bankedValue`, each meaning one thing. |
| 11 | `isArchived` never mentioned; soft-deleted leads would inflate pipeline value against every other count in the app. | Filtered everywhere (§8). |
| 12 | `NO_RESPONSE` seeded as lost, contradicting `lib/data/leads.ts:1091` and the dashboard funnel. | New `STALLED` outcome, excluded from both. |
| 13 | Nullable `stageId` alongside the existing enum: leads created by the inbound-email path would have no stage row and count as open forever. | No parallel column; the enum stays the single stage field. |
| 14 | Wrong paths: `utils/validators.ts` (a directory — a file there shadows the barrel and breaks 55 importers), `app/api/leads/[leadId]` (real path is under `(data)`), a `toNum` helper that does not exist, `package.json` seed config (this repo uses `prisma.config.ts`). | Corrected throughout. |
| 15 | Only `createLeadSchema` named, but `PATCH` validates against `updateLeadSchema`. | Both extended (§9e). |
| 16 | Mixed-currency machinery whose scalars blended currencies by naive addition anyway, with no per-currency weighted subtotal to fall back on. | Removed; AUD only. |
| 17 | A DB-backed integration test, in a repo with no test database and a live shared `DATABASE_URL`. | Pure-function tests; limitation stated (§10). |

---

## 13. Acceptance

- [ ] `pnpm typecheck` clean (baseline is clean — any error is new).
- [ ] `pnpm test` green, including the no-NaN assertions.
- [ ] `DATABASE_URL='postgresql://u:p@127.0.0.1:1/db' pnpm build` reaches "Generating static pages", exit 0.
- [ ] Migration applies; backfill is re-runnable without changing results.
- [ ] Saving an offer updates the linked lead's value; typing over it stops the sync; reverting resumes it.
- [ ] Moving a lead to Won stamps `wonAt` — **through the offer status path**, not only the modal.
- [ ] A deal expected 1 Jul (Sydney local) appears in FY Q1, not the prior quarter.
- [ ] Win-rate card shows `—` with no closes in the window, never `0%` or `NaN%`.
- [ ] Archived leads contribute nothing to any figure.
