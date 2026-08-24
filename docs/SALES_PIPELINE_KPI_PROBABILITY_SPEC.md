# Sales Pipeline with KPIs + Probability — Implementation Spec (Option 1)

> **Goal:** Add a numeric deal-value + per-stage probability + weighted-value + quarterly forecast layer to Royal-Construction's existing Leads, **without** copying any code from OpenConstructionERP (which is AGPL-3.0). We reuse only the *design* (schema fields + standard CRM math), implemented natively in Prisma + TypeScript to keep RC proprietary.

Reference inspiration (design only — do **not** copy code): OCE `crm` module. The math (weighted = value × probability / 100, quarterly commit = deals ≥80%) is standard CRM logic, not copyrightable.

---

## 0. Context — what RC has today

- **Stack:** Next.js 16 (App Router) · Prisma 7 on PostgreSQL · Clerk auth · TanStack Query · Tailwind + shadcn/ui · recharts.
- **`Lead` model** (`prisma/schema.prisma`): has `stage: LeadStage` enum, `budget: String?` (free-text range), `source`, `assignedId`, follow-up/meeting dates, `lostReason`. **No numeric deal value, no probability, no weighted value, no expected close date, no forecast.**
- **`LeadStage` enum:** NEW, CONTACTED, QUALIFIED, QUOTED, NEGOTIATING, WON, LOST, MEETING_SCHEDULED, IN_FOLLOW_UP, NO_RESPONSE, CONVERTED, CANCELLED, DISQUALIFIED.
- **Lead data layer:** `lib/data/leads.ts` (`getLeads`, `createLead`, `getLeadsStats`, `getAnalyticsData`). Lead UI type in `lib/leads/types.ts` (`Lead` interface, `LeadStage`).
- **Analytics UI:** `components/leads/views/analytics-view.tsx` (recharts: source pie, trend area, conversion/lost bar). `LeadAnalyticsData` in `types/lead.ts`.
- **KPI card pattern:** `components/offers/offer-kpi.tsx` uses `MetricCard`/`KPIListItem` from `components/common/metric-card.tsx` — reuse this pattern.
- **Leads API routes:** `app/api/(data)/leads/route.ts` (GET/POST), `app/api/(data)/leads/[leadId]/route.ts`, plus `app/api/leads/...`.

---

## 1. Prisma schema changes

### 1a. New `PipelineStage` model

Add to `prisma/schema.prisma`:

```prisma
model PipelineStage {
  id                       String   @id @default(uuid())
  code                     String   @unique          // e.g. "NEW", "QUALIFIED"
  name                     String                     // display: "New", "Qualified"
  displayOrder             Int      @default(0)
  defaultProbabilityPercent Int     @default(0)       // 0–100
  isFinal                  Boolean  @default(false)   // terminal stage (WON/LOST/etc.)
  isWon                    Boolean  @default(false)
  isLost                   Boolean  @default(false)   // LOST/CANCELLED/DISQUALIFIED
  color                    String   @default("")      // hex for kanban column
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  leads Lead[]

  @@index([displayOrder])
}
```

### 1b. Add fields to existing `Lead` model

Add these columns to `Lead` (keep `budget: String?` as-is for backward compat — it becomes a free-text note; the new numeric field is the source of truth for KPIs):

```prisma
  // ── Sales-pipeline deal economics (Option 1) ──────────────────────────
  estimatedValue      Decimal? @db.Decimal(14, 2)   // numeric deal value (nullable: unknown until quoted)
  currency            String   @default("AUD")      // ISO 4217; RC is AU-based, default AUD
  probabilityPercent  Int      @default(0)           // 0–100, override of stage default
  weightedValue       Decimal? @db.Decimal(14, 2)   // cached = estimatedValue * probabilityPercent / 100 (recomputed on save)
  expectedCloseDate   DateTime?                      // for forecasting
  stageId             String?                        // FK → PipelineStage (nullable during migration)
  pipelineStage       PipelineStage? @relation(fields: [stageId], references: [id], onDelete: SetNull)
```

> **Why keep both `stage: LeadStage` and `stageId`?** The enum is wired through the whole UI/service layer. During migration, `stageId` is a parallel column. Phase 2 can collapse the enum into `PipelineStage` lookups. Do **not** rip out the enum in this PR — too much surface area.

### 1c. Migration + seed

1. `npx prisma migrate dev --name add_pipeline_stage_and_deal_economics`
2. Create `prisma/seed-pipeline-stages.ts` seeding `PipelineStage` rows. Map each existing `LeadStage` enum value to a stage with a sensible default probability:

| code (match LeadStage) | name | order | defaultProbabilityPercent | isFinal | isWon | isLost | color |
|---|---|---|---|---|---|---|---|
| NEW | New | 0 | 10 | false | false | false | `#94a3b8` |
| CONTACTED | Contacted | 1 | 20 | false | false | false | `#38bdf8` |
| MEETING_SCHEDULED | Meeting Scheduled | 2 | 30 | false | false | false | `#60a5fa` |
| QUALIFIED | Qualified | 3 | 40 | false | false | false | `#0ea5e9` |
| IN_FOLLOW_UP | In Follow-up | 4 | 45 | false | false | false | `#818cf8` |
| QUOTED | Quoted | 5 | 55 | false | false | false | `#a78bfa` |
| NEGOTIATING | Negotiating | 6 | 70 | false | false | false | `#f59e0b` |
| WON | Won | 7 | 100 | true | true | false | `#22c55e` |
| CONVERTED | Converted | 8 | 100 | true | true | false | `#16a34a` |
| NO_RESPONSE | No Response | 9 | 0 | true | false | true | `#9ca3af` |
| CANCELLED | Cancelled | 10 | 0 | true | false | true | `#ef4444` |
| DISQUALIFIED | Disqualified | 11 | 0 | true | false | true | `#dc2626` |
| LOST | Lost | 12 | 0 | true | false | true | `#ef4444` |

3. **Backfill script** (`scripts/backfill-pipeline-stages.ts`): for every `Lead`, set `stageId` = the `PipelineStage` whose `code` equals the lead's `LeadStage` string. For leads where `estimatedValue` is null, leave it null (they're pre-quote). Run once after migrate.

4. Add `prisma/seed-pipeline-stages.ts` and the backfill to `package.json` scripts and to the deploy/seed flow.

---

## 2. Pure compute functions (no OCE code — standard CRM math)

Create `lib/leads/pipeline-math.ts`. All functions pure, Decimal-safe, no DB.

```ts
// lib/leads/pipeline-math.ts
import { Prisma } from "@prisma/client";

/** weighted = value × probability / 100, rounded to 2dp. Clamps probability 0–100. */
export function computeWeightedValue(
  value: Prisma.Decimal | number | null | undefined,
  probabilityPercent: number | null | undefined,
): Prisma.Decimal {
  const v = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value ?? 0);
  if (v.isNaN()) return new Prisma.Decimal(0);
  const pct = Math.max(0, Math.min(100, Math.trunc(probabilityPercent ?? 0)));
  return v.mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Quarter string "YYYY-Qn" → [startISO, endISO]. Handles leap years. */
export function periodBounds(period: string): [string, string] {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) throw new Error(`Invalid period '${period}', expected 'YYYY-Qn'`);
  const year = Number(m[1]); const q = Number(m[2]);
  const startMonth = 3 * (q - 1) + 1;
  const endMonth = startMonth + 2;
  const endDay = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1];
  return [`${year}-${String(startMonth).padStart(2,"0")}-01`, `${year}-${String(endMonth).padStart(2,"0")}-${endDay}`];
}

export interface PipelineMetrics {
  openCount: number;
  totalValue: Prisma.Decimal;          // sum estimatedValue of open leads
  weightedValue: Prisma.Decimal;       // sum weightedValue of open leads
  byStage: { stageId: string; code: string; name: string; count: number; total: Prisma.Decimal; weighted: Prisma.Decimal }[];
  winRate30d: Prisma.Decimal;          // won / (won + lost) in last 30d, percent
  byCurrency: { currency: string; total: Prisma.Decimal }[];
  mixedCurrency: boolean;
}

export interface ForecastResult {
  period: string;
  pipelineValue: Prisma.Decimal;
  weightedValue: Prisma.Decimal;
  wonValue: Prisma.Decimal;
  committedValue: Prisma.Decimal;      // open deals with probability ≥ 80% + won
  byCurrency: { currency: string; total: Prisma.Decimal }[];
  mixedCurrency: boolean;
  computedAt: string;
}

// Inputs: an array of lead-shaped rows with { estimatedValue, currency, probabilityPercent,
//   weightedValue, stage(code/isWon/isLost/isFinal), expectedCloseDate, wonAt/lostAt, createdAt }.
export function computePipelineMetrics(leads: LeadForMetrics[]): PipelineMetrics { /* ... */ }
export function computeForecast(leads: LeadForMetrics[], period: string): ForecastResult { /* ... */ }
export function computeWinRate(leads: LeadForMetrics[], fromISO?: string, toISO?: string): Prisma.Decimal { /* ... */ }
```

**Spec for the three compute bodies (mirror this logic exactly):**

- `computePipelineMetrics`: consider only **open** leads (stage not `isFinal`). `totalValue` = Σ `estimatedValue` (skip nulls). `weightedValue` = Σ `computeWeightedValue(estimatedValue, probabilityPercent)`. Group by stage → `{count, total, weighted}`. `winRate30d` = over leads with `isWon`/`isLost` and `wonAt`/`lostAt` within last 30 days: `won / (won+lost) × 100`. `byCurrency`: sum `estimatedValue` grouped by `currency`; `mixedCurrency` = `byCurrency.length > 1`.
- `computeForecast`: `[start,end] = periodBounds(period)`. For each lead whose `expectedCloseDate` is within `[start,end]`: if `isWon` → adds full value to `pipelineValue`, `weightedValue`, `wonValue`, `committedValue`; if open → adds value to `pipelineValue`, `computeWeightedValue` to `weightedValue`, and if `probabilityPercent >= 80` also adds full value to `committedValue`; lost/abandoned → skipped. `byCurrency`/`mixedCurrency` as above. `computedAt` = ISO now.
- `computeWinRate`: filter `isWon` (use `wonAt` or `updatedAt`) / `isLost` (`lostAt`/`updatedAt`) within `[fromISO,toISO]`; `won/(won+lost)*100`, `0` when denominator is 0.

**Important currency rule (learned from OCE's bug fix):** never blend currencies via FX. Always keep per-currency subtotals and surface a `mixedCurrency` warning flag. The scalar `totalValue`/`weightedValue` are fine for single-currency; when `mixedCurrency` is true, the UI must show the per-currency breakdown, not just the scalar.

---

## 3. Data layer (`lib/data/leads.ts`)

1. **On every lead write** (`createLead`, `updateLead`, and any stage-change helper), recompute and persist `weightedValue = computeWeightedValue(estimatedValue, probabilityPercent)`. When `probabilityPercent` isn't explicitly set, derive it from the linked `PipelineStage.defaultProbabilityPercent`.

2. **Stage change → probability sync:** when a lead's `stage`/`stageId` changes and the caller did not explicitly set `probabilityPercent`, set `probabilityPercent = stage.defaultProbabilityPercent`. (Won → 100, Lost → 0, etc. fall out naturally from the seed table.)

3. Add `getPipelineMetrics(): Promise<PipelineMetrics>` — fetch open leads (value/currency/probability/weighted/stage/expectedCloseDate/wonAt/lostAt) and run `computePipelineMetrics`. Prefer a single `prisma.lead.findMany` with `select` + `include: { pipelineStage: true }` over raw SQL (type-safer); only fall back to `$queryRaw` if perf demands.

4. Add `getForecast(period: string): Promise<ForecastResult>` — fetch leads with `expectedCloseDate != null`, run `computeForecast`.

5. Extend `getAnalyticsData()` to also return `pipelineMetrics` and (optionally) `forecast` for the current quarter, so the analytics view can render them in one call.

---

## 4. API routes

Add (App Router `route.ts` files), all Clerk-protected, returning JSON via the existing `successResponse`/`errorResponse` helpers:

- `app/api/(data)/leads/pipeline-metrics/route.ts` → `GET` → `getPipelineMetrics()`
- `app/api/(data)/leads/forecast/route.ts` → `GET ?period=2026-Q3` → `getForecast(period)` (validate `^\\d{4}-Q[1-4]$`)
- Extend `PATCH /api/leads/[leadId]` to accept `estimatedValue`, `currency`, `probabilityPercent`, `expectedCloseDate`. Add Zod validation in `utils/validators.ts`:
  - `estimatedValue`: non-negative decimal string/number, max 14 digits.
  - `currency`: `^[A-Z]{3}$`, default `AUD`.
  - `probabilityPercent`: int 0–100.
  - `expectedCloseDate`: ISO date string, optional.
- The create/update lead schema (`createLeadSchema`) should also accept these fields (optional).

---

## 5. Frontend types

In `lib/leads/types.ts`:

- Extend `Lead` interface with: `estimatedValue?: number | string | null`, `currency?: string`, `probabilityPercent?: number`, `weightedValue?: number | string | null`, `expectedCloseDate?: string | null`, `stageId?: string | null`.
- Add `PipelineStageUI` type (`id, code, name, displayOrder, defaultProbabilityPercent, isFinal, isWon, isLost, color`).
- Add `PipelineMetricsUI` / `ForecastUI` types mirroring the backend shapes (use `number` for money on the client — the API serializes Decimal → string; coerce with the existing `toNum`/Decimal helper used elsewhere in RC).

In `types/lead.ts` extend `LeadAnalyticsData` with `pipelineMetrics: PipelineMetricsUI` and `forecast?: ForecastUI`.

---

## 6. UI — KPI cards + forecast (reuse `MetricCard`)

### 6a. New component `components/leads/pipeline-kpi.tsx`

Follow `components/offers/offer-kpi.tsx` exactly. Four `MetricCard`s:
1. **Open Pipeline Value** — `pipelineMetrics.totalValue` (fmt currency).
2. **Weighted Pipeline** — `pipelineMetrics.weightedValue`.
3. **Win Rate (30d)** — `pipelineMetrics.winRate30d` + `%`.
4. **This-Quarter Forecast (committed)** — `forecast.committedValue` (label clarifies "≥80% probability + won").

If `pipelineMetrics.mixedCurrency`, show a small warning badge ("Mixed currencies — see breakdown") and render a tiny per-currency list under the card.

### 6b. New component `components/leads/forecast-chart.tsx`

recharts **bar chart**: one bar per stage (open leads only), stacked or grouped `totalValue` vs `weightedValue`. Plus a separate small **quarterly forecast** card: `pipelineValue` / `weightedValue` / `committedValue` / `wonValue` with a quarter selector (`Q1–Q4` of current year, default current quarter).

### 6c. Wire into `analytics-view.tsx`

Add `<PipelineKpi>` at the top of the analytics view and `<ForecastChart>` below the existing source/trend charts. Fetch via the extended `getAnalyticsData` (server component passes props) or a TanStack Query hook calling `/api/leads/pipeline-metrics` + `/api/leads/forecast` — match however `analytics-view` currently gets its data (it receives `analytics` props today, so prefer extending that prop shape).

### 6d. Edit lead — add deal economics fields

In whichever modal edits a lead (look at `components/leads/modal-ui/detail-modal.tsx` / `add-lead-modal.tsx`), add a "Deal economics" section:
- `estimatedValue` (number/currency input)
- `currency` (select: AUD default, plus NZD/USD/etc.)
- `probabilityPercent` (0–100 slider or number; show the stage's default as a hint/placeholder)
- `expectedCloseDate` (date picker)

Keep `budget` (free text) visible but mark it as "Notes"; `estimatedValue` is the numeric source of truth.

### 6e. (Optional, nice-to-have) Kanban pipeline board

If you want the AmoCRM-style board: new view `components/leads/views/pipeline-view.tsx` — columns = `PipelineStage` rows ordered by `displayOrder` (exclude `isLost` terminal stages into a collapsed "Lost/Archived" column), cards = open leads, drag-and-drop updates `stageId` via `PATCH /api/leads/[leadId]`. Use `@dnd-kit/core` (check if already a dep; if not, prefer a lightweight HTML5 drag implementation to avoid new deps). This is **optional** for the KPI/probability goal — only build if the user wants the visual pipeline.

---

## 7. Tests

RC uses `tsx --test` (see `package.json` `test` script). Add:

- `tests/leads/pipeline-math.test.ts` — pure unit tests for `computeWeightedValue` (incl. null/NaN/clamp), `periodBounds` (incl. Q1 leap year, invalid input), `computePipelineMetrics` (open-only filtering, by-stage grouping, win rate 30d, mixed currency flag), `computeForecast` (won vs open vs lost contribution, ≥80% commit, period filtering), `computeWinRate` (zero-denominator → 0).
- One integration test mirroring `tests/offer/*.test.ts` style: seed leads across stages/currencies/probabilities, assert `getPipelineMetrics` + `getForecast` numbers.

Edge cases to cover: null `estimatedValue` (skip from sums), `probabilityPercent` outside 0–100 (clamp), mixed currencies (flag true), empty pipeline (all zeros, no NaN), lead with `expectedCloseDate` outside the quarter (excluded from forecast).

---

## 8. Validation checklist (done = mergeable)

- [ ] `npx prisma migrate dev` succeeds; `prisma generate` clean.
- [ ] `seed-pipeline-stages` + backfill run idempotently (re-runnable).
- [ ] `npm run typecheck` clean.
- [ ] `npm run test` green (new tests pass).
- [ ] PATCH a lead with `estimatedValue` + `probabilityPercent` → `weightedValue` persisted correctly.
- [ ] Changing `stageId` to WON → `probabilityPercent` becomes 100; to LOST → 0.
- [ ] `GET /api/leads/pipeline-metrics` returns correct open-only sums.
- [ ] `GET /api/leads/forecast?period=2026-Q3` respects `expectedCloseDate` window.
- [ ] Analytics view renders 4 KPI cards + forecast chart; mixed-currency warning appears when relevant.
- [ ] No OCE/AGPL code copied — all new TS/Prisma written fresh in RC. (Grep the diff for any `openconstructionerp`/`oe_crm`/`DDC-CWICR` strings — there must be none.)

---

## 9. What we deliberately did NOT do (defer)

- Did **not** collapse the `LeadStage` enum into `PipelineStage` (too much UI surface; `stageId` runs parallel for now).
- Did **not** copy OCE's Kanban component (AGPL). The optional board in 6e is built fresh if wanted.
- Did **not** add an `Opportunity` model separate from `Lead` (RC's lead→offer→project flow already covers the "deal" lifecycle; adding numeric economics on `Lead` is the minimal sufficient change). If you later want pre-quote opportunities distinct from leads, split then.
- Did **not** add multi-currency FX conversion (per-currency subtotals + a warning flag is the correct v1).

---

## 10. Prompt for Claude Code

> "Implement the spec in `docs/SALES_PIPELINE_KPI_PROBABILITY_SPEC.md`. Work phase by phase: (1) Prisma schema + migration + seed + backfill, (2) `lib/leads/pipeline-math.ts` pure functions + tests, (3) wire `weightedValue` recompute into `createLead`/`updateLead` and stage changes in `lib/data/leads.ts`, (4) add `getPipelineMetrics`/`getForecast` + API routes, (5) extend `Lead` type + `LeadAnalyticsData`, (6) `PipelineKpi` + `ForecastChart` components wired into `analytics-view.tsx`, (7) deal-economics fields in the lead edit modal. Run `typecheck` + `test` after each phase. Do NOT copy any code from OpenConstructionERP — write everything fresh. Keep the existing `LeadStage` enum and `budget` field intact."
