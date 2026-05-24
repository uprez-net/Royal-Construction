# UI and React Best Practices Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the highest-impact UI accessibility, responsive design, React/Next.js performance, and anti-slop issues found in the Royal Construction / BuildPro audit without changing API contracts or product scope.

**Architecture:** Restore verification first, then make one bounded pass at a time: regression lock, de-slop, accessibility primitives, React render/data performance, bundle imports, CSS containment, and final cross-device verification. Keep App Router pages server-first, isolate client interactivity into focused components, use existing shadcn/Radix primitives, and prefer surgical no-contract fixes over API redesigns.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, Tailwind CSS 4, shadcn/ui, Radix UI, Clerk, Redux Toolkit, Prisma, Recharts, pnpm 9.8.0.

---

## Revision Notes From Review

This plan was revised before execution to address the review findings:

- Corrected invalid `pnpm-workspace.yaml` guidance: use `packages`, `onlyBuiltDependencies`, and `ignoredBuiltDependencies`; do not use the invalid `allowBuilds` map.
- Added per-phase regression/quality gates before and after each cleanup phase.
- Added an explicit `components/ui/dialog.tsx` prerequisite check before replacing custom modals. This repo currently has that file.
- Removed API response-shape consolidation from the cleanup plan. `/api/leads` contract changes are out of scope.
- Added Vercel rules for `bundle-barrel-imports`, `server-cache-react`, and the `rerender-*` scan pass.
- Scoped analytics truthfulness to a small label/copy fix only; real analytics wiring is a separate product/backend task.
- Added a dedicated `app/globals.css` containment sub-plan: `docs/superpowers/plans/2026-05-21-globals-css-containment-subplan.md`.

---

## Non-Negotiable Constraints

- No API response-shape changes in this plan.
- No new dependencies unless a separate user-approved dependency task is created.
- No broad visual redesign; this is UI quality, accessibility, performance, and cleanup.
- Each phase must have a before/after verification gate.
- If a phase cannot pass the gate because the repo baseline is already broken, record the exact failure in `docs/audits/2026-05-21-ui-react-baseline.md` before continuing.
- Every changed file must trace to one of the audited issues or the user review feedback.

---

## File Map

### Verification/tooling

- Modify: `pnpm-workspace.yaml` — make workspace YAML valid for pnpm 9.
- Create: `docs/audits/2026-05-21-ui-react-baseline.md` — record baseline lint/type/build/browser state before code edits.

### Leads cleanup/accessibility

- Modify: `components/leads/leads.tsx` — remove dead simulation code, stop duplicate stats fetch, replace custom modal/toast patterns where touched.
- Modify: `components/leads/views/table-view.tsx` — split helpers, replace clickable spans/icon-only labels, dynamic-import `xlsx`, remove `as any`.
- Modify: `components/leads/views/pipeline-view.tsx` — remove unused imports, reuse shared email/template helpers, replace custom modal patterns.
- Modify: `components/leads/views/followups-view.tsx` — hoist duplicated per-row email/template/modal logic.
- Create: `components/leads/lead-template-utils.ts` — shared template hydration helpers.
- Create: `components/leads/lead-formatters.ts` — shared lead date/phone display helpers.
- Create: `components/leads/lead-email-draft.ts` — shared email draft building.

### Shared UI/accessibility

- Modify: `components/common/app-shell.tsx` — isolate clock, fix nested scroll, remove/render unused props.
- Create: `components/common/app-shell-clock.tsx` — isolated live clock client component.
- Modify: `components/common/searchable-select.tsx` — justified because audit found missing label association and mouse-only clear control.
- Modify: `components/projects/project-toolbar.tsx` — justified because audit found unlabeled search and title-only/custom toggle controls.
- Modify: `components/projects/project-filters.tsx` — add selected-state semantics if touched by project toolbar work.
- Modify: `components/projects/enhanced-project-card.tsx` — semantic clickable card, replace emoji icon, guard zero-budget math.

### React/data/bundle/CSS

- Modify: `components/projects/projects-client.tsx` — avoid identical initial-data refetch.
- Modify: `components/tradies/tradies-client.tsx` — avoid identical initial-data refetch.
- Modify: `lib/data/tradies.ts` — remove placeholder empty-project query only if verified as dead DB work.
- Modify: `app/(main)/dashboard/page.tsx` — resolve client/server status after inspection; do not change if interactivity requires client.
- Modify: `app/(main)/leads/page.tsx` — replace `@/components/leads` barrel import with direct import if scan confirms bundle impact.
- Modify: `components/leads/index.ts` — avoid exporting client component and lead services through one barrel if bundle scan confirms risk.
- Modify: `app/globals.css` — only via the dedicated CSS sub-plan.

---

## Phase 0 — Restore Verification Gates and Baseline Lock

### Task 0.1: Fix workspace YAML syntax

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] Replace invalid `allowBuilds` map with valid pnpm 9 workspace settings.

Use this candidate content:

```yaml
packages:
  - "."

onlyBuiltDependencies:
  - "@clerk/shared"
  - "@prisma/engines"
  - "esbuild"
  - "msw"
  - "prisma"
ignoredBuiltDependencies:
  - "sharp"
  - "unrs-resolver"
```

- [ ] Verify workspace command no longer fails before scripts start.

Run:

```bash
pnpm lint
```

Expected before deps are installed: either ESLint output or dependency/tooling output. Not expected:

```text
ERROR packages field missing or empty
```

### Task 0.2: Install dependencies and read local Next docs

**Files:**
- No source changes.

- [ ] Install from lockfile.

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: install completes without workspace YAML errors.

- [ ] Read local Next.js docs before framework edits, per repo instructions.

Run:

```bash
find node_modules/next/dist/docs -maxdepth 2 -type f | head -20
```

Expected: docs paths print. If this path is absent in installed Next 16, record the exact absence in baseline notes and use installed package docs/source files before framework-specific edits.

### Task 0.3: Record baseline gates before cleanup

**Files:**
- Create: `docs/audits/2026-05-21-ui-react-baseline.md`

- [ ] Run baseline gates.

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

- [ ] Start local app and capture route baseline if build/dev can run.

Run:

```bash
pnpm dev
```

Open/check:

```text
/
/dashboard
/leads
/projects
/tradie
```

- [ ] Write baseline notes with exact output.

Template:

```markdown
# UI/React Baseline — 2026-05-21

## Static Gates

- `pnpm lint`: PASS/FAIL — exact output summary
- `pnpm typecheck`: PASS/FAIL — exact output summary
- `pnpm build`: PASS/FAIL — exact output summary

## Route Smoke

- `/`: PASS/FAIL/BLOCKED — notes
- `/dashboard`: PASS/FAIL/BLOCKED — notes
- `/leads`: PASS/FAIL/BLOCKED — notes
- `/projects`: PASS/FAIL/BLOCKED — notes
- `/tradie`: PASS/FAIL/BLOCKED — notes

## Known Baseline Failures

- exact failure text
```

Gate: do not start Phase 1 until this file exists and static gate failures are either green or recorded as baseline failures.

---

## Phase 1 — Regression-Protected Lead De-Slop

### Task 1.1: Create a focused inventory before edits

**Files:**
- Modify later: `components/leads/leads.tsx`
- Modify later: `components/leads/views/table-view.tsx`
- Modify later: `components/leads/views/pipeline-view.tsx`
- Modify later: `components/leads/views/followups-view.tsx`

- [ ] Capture exact duplicate/dead-code anchors.

Run:

```bash
rg -n "simNames|simLocations|simKeywords|simIndex|nextId|simulateNewLead|hydrateTemplate|buildEmailDraft|buildSnippet|previewTemplateText|formatShortDate|as any|from 'zod'|from \"zod\"" components/leads
```

Expected: list of current anchors to remove/extract. Save relevant output into the baseline doc or phase notes.

- [ ] Run before-edit gate.

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS or known baseline failures only.

### Task 1.2: Extract shared lead helper modules

**Files:**
- Create: `components/leads/lead-template-utils.ts`
- Create: `components/leads/lead-formatters.ts`
- Create: `components/leads/lead-email-draft.ts`
- Modify: the four lead files listed in Task 1.1.

- [ ] Move only duplicated pure helpers first. Do not move React state, modal rendering, or side-effecting email send handlers in this task.

Required module boundaries:

```text
lead-template-utils.ts: placeholder replacement and template preview only
lead-formatters.ts: display/date/phone formatting only
lead-email-draft.ts: compose subject/body draft from lead + template only
```

- [ ] Verify after helper extraction.

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: no new errors beyond baseline. If errors appear, fix before continuing.

### Task 1.3: Delete dead lead code after extraction

**Files:**
- Modify: `components/leads/leads.tsx`
- Modify: `components/leads/views/pipeline-view.tsx`
- Modify: `components/leads/views/table-view.tsx`

- [ ] Remove only audited dead/stale items:
  - `simNames`, `simLocations`, `simKeywords`, `simIndex`, `nextId`, commented `simulateNewLead` block.
  - unused `set` import from `zod` in `pipeline-view.tsx`.
  - unused `SourceIcon` only if no rendered source column uses it.
  - `history: detailForm.historyEntries as any`, replacing it with a typed mapper.

- [ ] Verify dead-code pass.

Run:

```bash
pnpm typecheck
pnpm lint
rg -n "simNames|simLocations|simKeywords|simIndex|nextId|simulateNewLead|as any|from 'zod'|from \"zod\"" components/leads
```

Expected: removed anchors are gone; remaining `zod` imports are intentional and used.

---

## Phase 2 — Dialog and Toast Accessibility, With Prerequisite Check

### Task 2.1: Verify shadcn/Radix dialog exists

**Files:**
- Read: `components/ui/dialog.tsx`

- [ ] Check prerequisite.

Run:

```bash
test -f components/ui/dialog.tsx && sed -n '1,220p' components/ui/dialog.tsx
```

Expected: `Dialog`, `DialogContent`, `DialogTitle`, and `DialogDescription` are exported. This audit already found the file exists.

If missing: stop Phase 2 and create a separate shadcn component installation task. Do not silently implement another custom dialog.

### Task 2.2: Replace one lead modal shell at a time

**Files:**
- Modify: `components/leads/leads.tsx`
- Modify: `components/leads/views/table-view.tsx`
- Modify: `components/leads/views/pipeline-view.tsx`
- Modify: `components/leads/views/followups-view.tsx`

- [ ] For each file, replace the custom modal shell with existing `components/ui/dialog.tsx` exports.

Required semantics for each converted modal:

```text
Dialog wraps open/onOpenChange state
DialogContent contains the modal panel
DialogTitle names the modal
DialogDescription exists or is intentionally omitted only when title fully describes the dialog
DialogClose or close action remains reachable by keyboard
```

- [ ] After each file conversion, run:

```bash
pnpm typecheck
pnpm lint
```

Expected: no new type/lint errors.

- [ ] Browser/keyboard smoke after all modal conversions:

```text
Open /leads
Open each converted modal
Tab stays inside modal while open
Escape closes modal
Focus returns to trigger or nearest stable control
```

Record result in `docs/audits/2026-05-21-ui-react-baseline.md` under a Phase 2 section.

### Task 2.3: Replace duplicated custom toasts

**Files:**
- Modify only lead files converted in Task 2.2.

- [ ] Replace local toast arrays/timers with existing Sonner `toast` calls.

- [ ] Verify no orphaned timeout cleanup risk remains.

Run:

```bash
rg -n "setTimeout\(|showToast|toast\s*\[|setToasts|clearTimeout" components/leads
pnpm typecheck
pnpm lint
```

Expected: local custom toast state is removed or justified; no new errors.

---

## Phase 3 — Accessibility Pass With Scope Justification

Scope justification:

- `components/common/searchable-select.tsx` is included because the audit found a label not associated with a control and a mouse-only clear `div`.
- `components/projects/project-toolbar.tsx` is included because the audit found unlabeled search/view controls and custom dropdown semantics.
- `components/projects/enhanced-project-card.tsx` is included because the audit found a clickable card `div`, emoji icon, and unguarded budget math.

### Task 3.1: Fix labels and input metadata

**Files:**
- Modify: `components/leads/leads.tsx`
- Modify: `components/leads/views/table-view.tsx`
- Modify: `components/leads/views/pipeline-view.tsx`
- Modify: `components/leads/views/followups-view.tsx`
- Modify: `components/common/searchable-select.tsx`
- Modify: `components/projects/project-toolbar.tsx`

- [ ] Add `id`/`htmlFor` pairs, `name`, `type`, and `autoComplete` where applicable.

Target pattern:

```tsx
<Label htmlFor="lead-phone">Phone</Label>
<Input id="lead-phone" name="phone" type="tel" autoComplete="tel" />

<Label htmlFor="lead-email">Email</Label>
<Input id="lead-email" name="email" type="email" autoComplete="email" />
```

- [ ] Verify with static scan and browser spot check.

Run:

```bash
rg -n "<label(?![^>]*htmlFor)|<Label(?![^>]*htmlFor)|type=\"text\"|type='text'" components/leads components/common/searchable-select.tsx components/projects/project-toolbar.tsx
pnpm typecheck
pnpm lint
```

Expected: remaining text inputs are intentional; labels are associated or documented.

### Task 3.2: Replace mouse-only controls

**Files:**
- Modify: `components/common/searchable-select.tsx`
- Modify: `components/leads/views/table-view.tsx`
- Modify: `components/projects/enhanced-project-card.tsx`

- [ ] Replace clickable `div`/`span` controls with semantic `button`/`Link` or keyboard-accessible equivalents.

Required examples:

```tsx
<button type="button" aria-label="Clear selection" onClick={clearSelection}>
  <X className="h-4 w-4" aria-hidden="true" />
</button>
```

```tsx
<Link href={projectHref} className="...">
  ...card content...
</Link>
```

- [ ] Verify keyboard access.

Run:

```bash
rg -n "<div[^>]+onClick|<span[^>]+onClick|title=\"(View|Edit|Delete|Call|Email|Export|Grid|List)" components/common components/leads components/projects
pnpm typecheck
pnpm lint
```

Expected: any remaining clickable non-buttons are justified and keyboard-accessible with role/tabIndex/onKeyDown.

### Task 3.3: Add pressed/expanded semantics

**Files:**
- Modify: `components/projects/project-filters.tsx`
- Modify: `components/projects/project-toolbar.tsx`
- Modify: lead filter/tab files touched earlier.

- [ ] Add `aria-pressed` for toggle/filter buttons and `aria-expanded`/`aria-haspopup` for custom dropdown triggers.

- [ ] Verify:

```bash
rg -n "aria-pressed|aria-expanded|aria-haspopup|role=\"tablist\"|role=\"tab\"" components/projects components/leads
pnpm typecheck
pnpm lint
```

Expected: toggles/dropdowns/tabs expose state.

---

## Phase 4 — React/Next.js Performance Without API Contract Drift

### Task 4.1: Scan large client components against rerender rules

**Files:**
- Read first: `components/leads/leads.tsx`
- Read first: `components/leads/views/table-view.tsx`
- Read first: `components/tradies/tradies-client.tsx`
- Read first: `components/projects/projects-client.tsx`
- Read first: `components/common/app-shell.tsx`

- [ ] Run Vercel rerender scan.

```bash
rg -n "useState\(|useEffect\(|useMemo\(|useCallback\(|setInterval|JSON\.stringify\(|\.filter\(|\.map\(|\.reduce\(" components/leads components/tradies components/projects components/common/app-shell.tsx
```

Classify findings under these rules before editing:

```text
rerender-dependencies
rerender-derived-state
rerender-derived-state-no-effect
rerender-functional-setstate
rerender-lazy-state-init
rerender-memo
rerender-split-combined-hooks
rerender-use-deferred-value
rerender-use-ref-transient-values
rerender-no-inline-components
```

Gate: choose only the issues that are directly tied to audited rerenders/fetches in this plan. Move speculative optimizations to a later backlog.

### Task 4.2: Isolate AppShell clock rerender

**Files:**
- Create: `components/common/app-shell-clock.tsx`
- Modify: `components/common/app-shell.tsx`

- [ ] Move one-second time state into `AppShellClock`.

Verification:

```bash
rg -n "setInterval|setTime|new Date\(" components/common/app-shell.tsx components/common/app-shell-clock.tsx
pnpm typecheck
pnpm lint
```

Expected: interval exists only in `app-shell-clock.tsx`; `app-shell.tsx` no longer owns clock state.

### Task 4.3: Stop duplicate lead stats fetching without API shape changes

**Files:**
- Modify: `components/leads/leads.tsx`
- Modify only if moving data server-side later: relevant server data module, wrapped with `cache()` from React.
- Do not modify response shape in: `app/api/(data)/leads/route.ts`.

- [ ] Preferred current-client fix: fetch leads once, compute stats from the fetched leads in the same client flow, and stop calling `fetchLeadsStats()` alongside `fetchLeads()`.

- [ ] Preferred server/RSC fix if the data load is moved server-side in a separate task: wrap the underlying server data function with React `cache()` for per-request dedupe.

Target server pattern only if applicable:

```ts
import { cache } from "react";

export const getLeadsForPage = cache(async () => {
  return prisma.lead.findMany({ orderBy: { createdAt: "desc" } });
});
```

- [ ] Explicitly verify no API contract drift.

Run:

```bash
git diff -- app/api/\(data\)/leads/route.ts
rg -n "fetchLeads\(|fetchLeadsStats\(" components/leads/leads.tsx lib/leads/leads-service.ts
pnpm typecheck
pnpm lint
```

Expected: no diff in `/api/leads` route response shape; `components/leads/leads.tsx` does not call both fetches for initial load.

### Task 4.4: Stop identical post-hydration refetches

**Files:**
- Modify: `components/projects/projects-client.tsx`
- Modify: `components/tradies/tradies-client.tsx`

- [ ] Add a first-render query-signature guard so server-provided initial data is not refetched with identical filters.

Verification:

```bash
rg -n "useRef|initialQuery|querySignature|hasHydrated|skipInitial" components/projects/projects-client.tsx components/tradies/tradies-client.tsx
pnpm typecheck
pnpm lint
```

Browser expected:

```text
/projects initial load: no immediate duplicate identical API request after hydration
/tradie initial load: no immediate duplicate identical API request after hydration
```

### Task 4.5: Resolve dashboard client/server status before changing it

**Files:**
- Read: `app/(main)/dashboard/page.tsx`

- [ ] Decide before editing whether the page needs client mode.

Run:

```bash
sed -n '1,220p' 'app/(main)/dashboard/page.tsx'
rg -n "useState|useEffect|onClick|window|document|useRouter|useSearchParams" 'app/(main)/dashboard/page.tsx'
```

- [ ] If no client-only APIs are used, remove `"use client"`.
- [ ] If client APIs are used, leave the file as client and document why in the audit notes.

Verification:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

---

## Phase 5 — Bundle Scan and Fixes

### Task 5.1: Scan barrel imports before touching imports

**Files:**
- Read: `components/leads/index.ts`
- Read: `lib/store/index.ts`
- Read: `utils/validators/index.ts`
- Read import sites from scan output.

- [ ] Run bundle-barrel scan.

```bash
find components lib utils app hooks types -name 'index.ts' -o -name 'index.tsx' | sort
rg -n "from ['\"]@/components/leads['\"]|from ['\"]@/lib/store['\"]|from ['\"]@/utils/validators['\"]|from ['\"]\.\/validators['\"]|from ['\"]\.\/index['\"]" app components lib utils hooks types
```

Current audited candidates:

```text
app/(main)/leads/page.tsx imports { Leads } from "@/components/leads"
components/providers/redux-provider.tsx imports { store } from "@/lib/store"
lib/store/slices/projectsSlice.ts imports RootState from "@/lib/store"
lib/store/slices/tradiesSlice.ts imports RootState from "@/lib/store"
utils/validator.ts imports from "./validators"
several API routes import from "@/utils/validators"
```

- [ ] Only change import sites that affect client bundles or create cycles. Server-only API validator barrels can be documented as backend follow-up unless build trace shows a real bundle issue.

Verification:

```bash
pnpm build
```

Expected: no new module resolution errors.

### Task 5.2: Dynamic-import `xlsx`

**Files:**
- Modify: `components/leads/views/table-view.tsx`

- [ ] Remove static top-level `xlsx` import.

Target pattern inside export handler:

```ts
const XLSX = await import("xlsx");
```

- [ ] Verify:

```bash
rg -n "from ['\"]xlsx['\"]|import\(['\"]xlsx['\"]\)" components/leads/views/table-view.tsx
pnpm typecheck
pnpm lint
pnpm build
```

Expected: only dynamic import remains.

### Task 5.3: Remove unused chart imports surgically

**Files:**
- Modify: `components/leads/views/analytics-view.tsx`

- [ ] Run exact import scan before editing.

```bash
sed -n '1,80p' components/leads/views/analytics-view.tsx
rg -n "RechartsLineChart|Line,|Tooltip|ResponsiveContainer|Legend" components/leads/views/analytics-view.tsx
```

- [ ] Remove only unused imports confirmed by TypeScript/ESLint.

Verification:

```bash
pnpm typecheck
pnpm lint
```

---

## Phase 6 — CSS Containment Sub-Plan

Do not treat `app/globals.css` as a quick cleanup. Use the dedicated sub-plan:

```text
docs/superpowers/plans/2026-05-21-globals-css-containment-subplan.md
```

Minimum in this plan:

- [ ] Run the CSS inventory from the sub-plan.
- [ ] Add reduced-motion safety if missing.
- [ ] Fix confirmed typo-level CSS defects such as `cursor pointer`.
- [ ] Do not attempt a full 2366-line rewrite in the same pass as React/accessibility refactors.

Gate:

```bash
pnpm build
pnpm lint
```

Expected: visual behavior preserved except intentional reduced-motion/accessibility fixes.

---

## Phase 7 — Analytics Truthfulness Scope Boundary

### Task 7.1: Label demo analytics; do not wire real analytics here

**Files:**
- Modify: `components/leads/views/analytics-view.tsx`

- [ ] If monthly trend and lost-reason data remain static/mock, add a concise visible label such as `Demo trend data` or `Sample data` near those charts.

- [ ] Do not wire real monthly/lost-reason backend analytics in this plan. That is a separate product/data task.

Verification:

```bash
rg -n "Demo|Sample|mock|MONTHLY_TREND|LOST_REASONS_DATA" components/leads/views/analytics-view.tsx
pnpm typecheck
pnpm lint
```

Expected: static/demo chart data is visibly labeled or moved out of user-facing analytics.

---

## Phase 8 — Final Verification

- [ ] Static gates:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

- [ ] Browser UI verification at 375, 768, 1024, and 1440 px:

```text
/
/dashboard
/leads
/projects
/tradie
```

- [ ] Keyboard-only checks:

```text
App shell nav is reachable
Lead modals open/close with keyboard
Lead tabs/filters expose selected state
Project cards are activatable without mouse
Toolbar dropdowns expose expanded state
```

- [ ] Accessibility semantics spot check:

```text
Forms announce labels
Dialogs announce title/description
Icon-only buttons announce useful labels
Charts have labels or text summaries
```

- [ ] Performance spot check:

```text
App shell does not rerender whole layout every second
/leads initial load does not duplicate the same leads fetch for stats
/projects does not immediately refetch identical initial server data
/tradie does not immediately refetch identical initial server data
lead table export does not load xlsx before export action
```

- [ ] Final report must include:

```text
Changed files
Simplifications made
Per-phase gates run
Browser/a11y checks run
Known remaining risks
Deferred product/backlog items
```
