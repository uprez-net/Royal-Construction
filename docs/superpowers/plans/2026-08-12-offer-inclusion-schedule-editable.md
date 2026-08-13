# Editable Offer & Tender Inclusions and Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every inclusion and exclusion that prints on the offer **or** the tender is editable by the estimator in the Offer phase, and every surface that displays them shows the same list.

**Architecture:** Today the inclusions/exclusions a client reads come from six different places across three workflow steps and two hard-coded constants, and the three display surfaces each apply a *different* rule for combining them. This plan makes the full Inclusions Schedule a per-offer editable field on `OfferDocumentDraft`, adds the missing exclusion editor, routes every surface through one shared resolver, and drops the `Category` column so the schedule prints as plain specification wording. Seeding is deterministic — the template constant becomes seed data only; there is no AI in this plan.

## The problem, stated precisely

**Where the printed inclusions/exclusions come from today:**

| What prints | Source | Editable in Offer phase? |
|---|---|---|
| Offer PDF "This price includes" | `draft.inclusionBullets` | ✅ Step 5 |
| Offer PDF "Full inclusions schedule" (3 pages) | `STANDARD_INCLUSIONS_SCHEDULE` constant | ❌ **code only** |
| Tender "Scope of Works — Inclusions Schedule" | `STANDARD_INCLUSIONS_SCHEDULE` constant | ❌ **code only** |
| Offer PDF "This price excludes" | `draft.exclusionBullets` ∪ scope items | ❌ bullets have **no editor** |
| Tender "Exclusions" | same union | ❌ same |
| Offer PDF allowances table | `allowances[]` scope items | ✅ Step 4 |
| Tender scope line | `job.buildScope` | ⚠️ Step 1 — **freezes at send** |

**And the three display surfaces disagree with the PDF and with each other:**

| Surface | Inclusions shown | Exclusions shown |
|---|---|---|
| Offer PDF / tender PDF | bullets; schedule from constant | bullets **∪** scope items |
| Offer on-screen preview | cost-line wording (`offer-workspace-preview.tsx:141`) | scope items **only** (`:207`) |
| Tender on-screen | `inclusionBullets` (`offer-workspace-tender.tsx:465`) | bullets **if any, else** scope items (`:428`) |

Three surfaces, three different exclusion rules — `getVisibleExclusions` unions, the preview ignores the bullets entirely, the tender treats them as an override. An estimator cannot predict what the client will receive from anything on screen. That is the defect this plan closes.

**The design response:** one editable source per concept, one shared resolver, every surface rendering the resolver's output.

**Tech Stack:** Next.js (App Router, Cache Components), TypeScript, Zod (snapshot schema + migrations), Redux Toolkit (`adminOfferContentSlice` — untouched here), `node:test` via `tsx --test`, React `renderToStaticMarkup` for renderer tests.

## Global Constraints

- **This is NOT the Next.js you know.** Read the relevant guide in `node_modules/next/dist/docs/` before writing any code that touches routing, caching, or data fetching. This plan touches none of those, but heed the rule if you stray.
- **Test runner:** `pnpm test` → `tsx --test tests/*/*.test.ts`. Tests use `node:test` (`test`) and `node:assert/strict` (`assert`). Only files matching `tests/<dir>/<name>.test.ts` are collected.
- **Build must not query the DB.** Do not add a `'use cache'` fetcher that prefills at build time. Nothing in this plan needs one.
- **Offer editability follows ADR 0005.** The **Offer document** step is editable while `pending` **or** `sent`. `inclusionSchedule` lives on that step and inherits that rule — do **not** add a new lock.
- **Money never changes here.** The inclusion schedule is descriptive text. It must not enter `calculateDirectTotal` or any pricing path.
- **Exact literal copy for the schedule intro** (offer): `All items below are fixed within your contract price. Design provided by owner/architect — all costs fixed as per approved plans, confirmed at colour selection.`
- **Exact literal copy for the schedule intro** (tender): `All items below are included in the Contract Sum and fixed as per the approved plans and specifications, confirmed at colour selection.`
- **Exact literal headings:** offer → `Full inclusions schedule` / `Full inclusions schedule (cont.)`; tender → `Scope of Works — Inclusions Schedule` / `Scope of Works — Inclusions Schedule (cont.)`. Em dash, not hyphen.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/offer/workspace-proposal-content.ts` | Modify. Keeps `STANDARD_INCLUSIONS_SCHEDULE` as **seed data only**; adds derived `STANDARD_INCLUSION_SPECIFICATIONS: readonly string[]`. |
| `lib/offer/workspace-model.ts` | Modify. `OfferDocumentDraft` gains `inclusionSchedule`; `INITIAL_OFFER_DRAFT` seeds it. |
| `lib/offer/workspace-persistence.ts` | Modify. Zod field, serialize/deserialize, v2→v3 migration seeding old snapshots from the template. |
| `lib/offer/admin-offer-prefill.ts` | Modify. `resolveDraft` seeds `inclusionSchedule` + real `exclusionBullets`. |
| `lib/offer/workspace-print-template.ts` | Modify. Delete the dead `offerTenderLineItems` field; **export `getVisibleExclusions`** as the one shared resolver. |
| `components/offers/new-workflow/offer-workspace-document.tsx` | Modify. Adds schedule editor, exclusions editor, "Pull from cost schedule" action, scope-exclusion visibility. |
| `components/offers/new-workflow/offer-workspace-preview.tsx` | Modify. Renders `draft.inclusionSchedule` and the shared exclusion resolver. |
| `components/offers/new-workflow/offer-workspace-tender.tsx` | Modify. Renders `draft.inclusionSchedule` and the shared exclusion resolver — currently the only surface treating bullets as an override. |
| `lib/offer/offer-proposal-html.ts` | Modify. Inclusions pages: 2-col table → numbered list, from the draft. |
| `lib/offer/offer-tender-html.ts` | Modify. Inclusions pages: 4-col table → numbered list, from the draft. |
| `components/offers/new-workflow/offer-workspace-print-template.tsx` | Modify. Same, for the on-screen/print surface. |
| `tests/offer/inclusion-schedule.test.ts` | Create. Seeding, migration, pull-from-cost-schedule merge. |
| `tests/offer/offer-proposal-pagination.test.ts` | Modify. Page-count expectations after the layout change. |
| `tests/offer/offer-document-print-pages.test.ts` | Modify. Same. |

### Deliberate consequences (call these out at review)

1. **`highlight` is dropped.** Three template rows (`Rendering — Full Facade`, `Kitchen Cabinetry`, `Ducted Air Con`) currently render with a gold background. A flat `string[]` cannot carry that flag. Their text survives; the gold emphasis does not.
2. **The `Category` column is gone** from both the offer PDF and the tender, per the decision recorded in the session that produced this plan. Only the specification wording renders.
3. **`OFFER_SPEC_FACTS` still matters.** It keeps `inclusionBullets` and the seeded schedule agreeing on `40mm` / `600 x 1200 porcelain tiles` / `18kW 4-zone` at seed time. Once an estimator edits either list, they can diverge — that is now a human decision, not a code bug.

---

## Task 1: Per-offer `inclusionSchedule` field, seeded and persisted

**Files:**
- Modify: `lib/offer/workspace-proposal-content.ts` (append after line 261)
- Modify: `lib/offer/workspace-model.ts:180-186`, `:909-917`
- Modify: `lib/offer/workspace-persistence.ts:285-291`, `:402-414`, `:493-499`, `:558`
- Modify: `lib/offer/admin-offer-prefill.ts:153-164`
- Test: `tests/offer/inclusion-schedule.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `STANDARD_INCLUSION_SPECIFICATIONS: readonly string[]` from `lib/offer/workspace-proposal-content.ts`
  - `OfferDocumentDraft.inclusionSchedule: readonly string[]`
  - `INITIAL_OFFER_DRAFT.inclusionSchedule` seeded to `STANDARD_INCLUSION_SPECIFICATIONS`
  - `migrateWorkspaceState` now emits `schemaVersion: 3`

- [ ] **Step 1: Write the failing test**

Create `tests/offer/inclusion-schedule.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_INCLUSION_SPECIFICATIONS,
  STANDARD_INCLUSIONS_SCHEDULE,
} from "../../lib/offer/workspace-proposal-content";
import { INITIAL_OFFER_DRAFT } from "../../lib/offer/workspace-model";
import { migrateWorkspaceState } from "../../lib/offer/workspace-persistence";

test("STANDARD_INCLUSION_SPECIFICATIONS is every template specification, in order", () => {
  assert.deepEqual(
    STANDARD_INCLUSION_SPECIFICATIONS,
    STANDARD_INCLUSIONS_SCHEDULE.map((row) => row.specification),
  );
});

test("a new offer draft seeds the full template schedule", () => {
  assert.deepEqual(
    INITIAL_OFFER_DRAFT.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("v2 snapshots migrate to v3 seeded with the template schedule", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: ["A"],
      exclusionBullets: [],
      termsSummary: "T",
    },
  }) as { schemaVersion: number; draft: { inclusionSchedule: string[] } };

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(
    migrated.draft.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("migration does not clobber a schedule that is already present", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: ["Only this one"],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, ["Only this one"]);
});

test("an estimator who empties the schedule keeps it empty through v3", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 3,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: [],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — `STANDARD_INCLUSION_SPECIFICATIONS` is not exported.

- [ ] **Step 3: Derive the flat specification list**

Append to `lib/offer/workspace-proposal-content.ts` (after `STANDARD_INCLUSIONS_SCHEDULE` ends at line 261):

```ts
// The schedule as the customer now sees it: specification sentences only.
// The grouped/categorised rows above are SEED DATA — they populate a new
// offer's editable `draft.inclusionSchedule` and are never rendered directly.
// Category headings and the `highlight` flag are deliberately not carried:
// the printed schedule is a plain numbered list of what is included.
export const STANDARD_INCLUSION_SPECIFICATIONS: readonly string[] =
  STANDARD_INCLUSIONS_SCHEDULE.map((row) => row.specification);
```

- [ ] **Step 4: Add the field to the draft model**

In `lib/offer/workspace-model.ts`, extend the type at line 180:

```ts
export type OfferDocumentDraft = {
  readonly headline: string;
  readonly introText: string;
  readonly inclusionBullets: readonly string[];
  readonly exclusionBullets: readonly string[];
  // The full Inclusions Schedule printed on the offer and the tender — one
  // specification sentence per entry. Per-offer and estimator-editable; seeded
  // from STANDARD_INCLUSION_SPECIFICATIONS. Distinct from inclusionBullets,
  // which is the short Investment Summary teaser on the price page.
  readonly inclusionSchedule: readonly string[];
  readonly termsSummary: string;
};
```

Add the import at the top of the file (it already imports from `./workspace-proposal-content` at lines 9-10 — extend that import) and seed at line 913:

```ts
  inclusionBullets: OFFER_INCLUDES_BULLETS,
  exclusionBullets: OFFER_EXCLUDES_BULLETS,
  inclusionSchedule: STANDARD_INCLUSION_SPECIFICATIONS,
```

- [ ] **Step 5: Add the persistence field and the v2→v3 migration**

In `lib/offer/workspace-persistence.ts`, extend `draftSchema` (line 285):

```ts
const draftSchema = z.object({
  headline: z.string(),
  introText: z.string(),
  inclusionBullets: z.array(z.string()),
  exclusionBullets: z.array(z.string()),
  // Defaulted so a snapshot that somehow skips the migration still parses;
  // migrateV2ToV3 is what actually seeds pre-existing offers.
  inclusionSchedule: z.array(z.string()).default([]),
  termsSummary: z.string(),
});
```

Extend `migrateWorkspaceState` (line 402) — note the version guard must run **after** `migrateV1ToV2` so a v1 snapshot lands on v3:

```ts
  let next = state;
  if (version < 2) {
    next = migrateV1ToV2(next);
  }
  if (version < 3) {
    next = migrateV2ToV3(next);
  }
  return next;
```

Add below `migrateV1ToV2`:

```ts
// v2 → v3: the Inclusions Schedule moves from a hard-coded module constant to
// per-offer editable copy on the draft. Snapshots written before this change
// carry no schedule, and re-rendering one (revision viewer, re-send) must
// reproduce the document the client actually received — so they are seeded
// with the template list that WAS the schedule at the time they were written.
// An explicitly empty array is left alone: from v3 on, "no rows" is a choice
// the estimator can make, not a missing field.
function migrateV2ToV3(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  return {
    ...state,
    schemaVersion: 3,
    draft: {
      ...draft,
      inclusionSchedule: Array.isArray(draft.inclusionSchedule)
        ? draft.inclusionSchedule
        : [...STANDARD_INCLUSION_SPECIFICATIONS],
    },
  };
}
```

Import `STANDARD_INCLUSION_SPECIFICATIONS` from `./workspace-proposal-content` at the top of the file.

Then thread the field through serialize (line 493) and deserialize (line 558). Serialize:

```ts
    draft: {
      headline: snapshot.draft.headline,
      introText: snapshot.draft.introText,
      inclusionBullets: [...snapshot.draft.inclusionBullets],
      exclusionBullets: [...snapshot.draft.exclusionBullets],
      inclusionSchedule: [...snapshot.draft.inclusionSchedule],
      termsSummary: snapshot.draft.termsSummary,
    },
```

`deserializeWorkspace` passes `draft: persisted.draft` wholesale (line 558), so it needs no change once the schema carries the field — confirm this by reading the surrounding lines rather than assuming.

- [ ] **Step 6: Seed the admin prefill path**

In `lib/offer/admin-offer-prefill.ts`, `resolveDraft` (line 153). Note the existing `exclusionBullets: []` is also fixed here — an admin-prefilled offer currently gets no exclusion bullets at all:

```ts
function resolveDraft(
  adminContent: AdminOfferContent,
): OfferDocumentDraft {
  const c = adminContent.offerContent;
  return {
    headline: c.headline,
    introText: c.introText,
    inclusionBullets: c.inclusions,
    exclusionBullets: [...OFFER_EXCLUDES_BULLETS],
    inclusionSchedule: [...STANDARD_INCLUSION_SPECIFICATIONS],
    termsSummary: c.termsAndConditions,
  };
}
```

Import both constants from `@/lib/offer/workspace-proposal-content`.

- [ ] **Step 7: Run the tests**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: PASS, 5/5.

Then run the whole suite to catch every construction site of `OfferDocumentDraft` that now misses a required field:

Run: `pnpm test`
Expected: type errors surface as failures in test files that build a draft literal. Fix each by adding `inclusionSchedule: STANDARD_INCLUSION_SPECIFICATIONS`. Also run `pnpm exec tsc --noEmit` to catch non-test construction sites (`new-offer-workspace.tsx`, `workspace-import.ts`).

- [ ] **Step 8: Commit**

```bash
git add lib/offer/workspace-proposal-content.ts lib/offer/workspace-model.ts \
        lib/offer/workspace-persistence.ts lib/offer/admin-offer-prefill.ts \
        tests/offer/inclusion-schedule.test.ts
git commit -m "feat(offers): add per-offer editable inclusion schedule to the draft"
```

---

## Task 2: Step 5 editors for the schedule and exclusions

**Files:**
- Modify: `components/offers/new-workflow/offer-workspace-document.tsx` (whole file — currently 105 lines)
- Modify: caller in `components/offers/new-workflow/offer-workspace-screen.tsx` (pass `lines`)
- Test: `tests/offer/inclusion-schedule.test.ts` (append)

**Interfaces:**
- Consumes: `OfferDocumentDraft.inclusionSchedule` (Task 1); `getIncludedOfferTenderLineItems(lines)` from `lib/offer/workspace-model.ts:985`.
- Produces: `mergeCostScheduleIntoSchedule(schedule, lines): readonly string[]`, exported from `lib/offer/workspace-proposal-content.ts`, used by the editor's "Pull from cost schedule" button.

- [ ] **Step 1: Write the failing test**

Append to `tests/offer/inclusion-schedule.test.ts`:

```ts
import { mergeCostScheduleIntoSchedule } from "../../lib/offer/workspace-proposal-content";
import { INITIAL_COST_LINES } from "../../lib/offer/workspace-model";
import type { OfferWorkspaceCostLine } from "../../lib/offer/workspace-model";

function costLine(
  overrides: Partial<OfferWorkspaceCostLine>,
): OfferWorkspaceCostLine {
  return {
    ...INITIAL_COST_LINES[0],
    id: "test-line",
    includedInContract: true,
    costExGst: 1000,
    offerTenderLineItem: "Test wording",
    ...overrides,
  };
}

test("pulling from the cost schedule appends only missing wording", () => {
  const result = mergeCostScheduleIntoSchedule(
    ["Existing spec", "Shared wording"],
    [
      costLine({ id: "a", offerTenderLineItem: "Shared wording" }),
      costLine({ id: "b", offerTenderLineItem: "New wording" }),
    ],
  );

  assert.deepEqual(result, ["Existing spec", "Shared wording", "New wording"]);
});

test("pulling ignores excluded and unpriced cost lines", () => {
  const result = mergeCostScheduleIntoSchedule(
    [],
    [
      costLine({ id: "a", includedInContract: false, offerTenderLineItem: "Excluded" }),
      costLine({ id: "b", costExGst: 0, offerTenderLineItem: "Unpriced" }),
      costLine({ id: "c", offerTenderLineItem: "   " }),
      costLine({ id: "d", offerTenderLineItem: "Kept" }),
    ],
  );

  assert.deepEqual(result, ["Kept"]);
});

test("pulling is idempotent", () => {
  const lines = [costLine({ id: "a", offerTenderLineItem: "Once" })];
  const once = mergeCostScheduleIntoSchedule([], lines);
  const twice = mergeCostScheduleIntoSchedule(once, lines);

  assert.deepEqual(twice, once);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — `mergeCostScheduleIntoSchedule` is not exported.

- [ ] **Step 3: Implement the merge helper**

Append to `lib/offer/workspace-proposal-content.ts`:

```ts
// Append any priced, included cost-schedule wording the schedule does not
// already carry, preserving the estimator's existing order and edits. Matching
// is on exact trimmed text — an estimator who has reworded a line keeps their
// wording AND gains the original, which is the safe direction to fail: a
// duplicate is visible and deletable, a silently dropped inclusion is not.
export function mergeCostScheduleIntoSchedule(
  schedule: readonly string[],
  lines: readonly OfferWorkspaceCostLine[],
): readonly string[] {
  const seen = new Set(schedule.map((entry) => entry.trim()));
  const additions = getIncludedOfferTenderLineItems(lines).filter(
    (item) => !seen.has(item),
  );
  return [...schedule, ...additions];
}
```

Import `getIncludedOfferTenderLineItems` and the `OfferWorkspaceCostLine` type from `./workspace-model`. **Check for an import cycle:** `workspace-model.ts` already imports from `workspace-proposal-content.ts` (lines 9-10). Import the *type* with `import type`, and if the value import of `getIncludedOfferTenderLineItems` creates a cycle at runtime, move `mergeCostScheduleIntoSchedule` into `lib/offer/workspace-model.ts` instead and update the test import. Verify with `pnpm exec tsc --noEmit` plus a passing test run, not by inspection.

- [ ] **Step 4: Add the two editors and the pull action**

In `components/offers/new-workflow/offer-workspace-document.tsx`. The existing `inclusionText` local-state pattern (lines 31-47) exists so pressing Enter is not undone by `textToLines` filtering the trailing empty line on every keystroke — **replicate it exactly** for the two new textareas rather than inventing a shorter approach. Extract it into a hook to avoid three copies:

```tsx
// Keeps raw textarea text local so a trailing newline survives a keystroke,
// while the draft stores only clean lines. Re-syncs when the lines change from
// OUTSIDE the editor (prefill, reload) via the store-previous-prop pattern.
function useLineEditor(
  lines: readonly string[],
  onLinesChange: (next: readonly string[]) => void,
) {
  const [text, setText] = useState(() => linesToText(lines));
  const [prevLines, setPrevLines] = useState(lines);
  if (lines !== prevLines) {
    setPrevLines(lines);
    const incoming = linesToText(lines);
    if (linesToText(textToLines(text)) !== incoming) {
      setText(incoming);
    }
  }
  return {
    value: text,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(event.target.value);
      onLinesChange(textToLines(event.target.value));
    },
  };
}
```

Rewrite the component to take `lines` and use the hook three times:

```tsx
type OfferDocumentEditorProps = {
  readonly draft: OfferDocumentDraft;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
};

export function OfferDocumentEditor({
  draft,
  lines,
  onDraftChange,
}: OfferDocumentEditorProps) {
  const inclusionBullets = useLineEditor(draft.inclusionBullets, (next) =>
    onDraftChange({ inclusionBullets: next }),
  );
  const inclusionSchedule = useLineEditor(draft.inclusionSchedule, (next) =>
    onDraftChange({ inclusionSchedule: next }),
  );
  const exclusionBullets = useLineEditor(draft.exclusionBullets, (next) =>
    onDraftChange({ exclusionBullets: next }),
  );
  // ... headline + introText unchanged ...
}
```

Add, after the existing "Inclusion bullets" field, these three blocks — schedule, its pull button, and exclusions:

```tsx
<label>
  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
    Inclusions schedule
  </span>
  <span className="mb-1 block text-xs text-muted-foreground">
    One specification per line. Printed as the numbered Inclusions Schedule on
    the offer and the tender.
  </span>
  <Textarea className="min-h-64 font-mono text-xs" {...inclusionSchedule} />
</label>
<div>
  <Button
    onClick={() =>
      onDraftChange({
        inclusionSchedule: mergeCostScheduleIntoSchedule(
          draft.inclusionSchedule,
          lines,
        ),
      })
    }
    size="sm"
    type="button"
    variant="outline"
  >
    Pull wording from cost schedule
  </Button>
  <p className="mt-1 text-xs text-muted-foreground">
    Appends the offer/tender wording of every included, priced cost line that
    is not already listed. Never removes or rewrites your edits.
  </p>
</div>
<label>
  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
    Exclusion bullets
  </span>
  <Textarea {...exclusionBullets} />
</label>
```

Import `Button` from `@/components/ui/button`, `mergeCostScheduleIntoSchedule` from `@/lib/offer/workspace-proposal-content`, and the `OfferWorkspaceCostLine` type.

- [ ] **Step 4b: Show the scope exclusions that also print**

The printed exclusion list is the **union** of `draft.exclusionBullets` and the Scope step's exclusion items (`getVisibleExclusions`). An estimator editing only the textarea cannot tell why an extra line appears on the PDF. Render the scope-sourced ones read-only underneath, so the editor accounts for everything that prints:

```tsx
{scopeExclusionLabels.length > 0 ? (
  <div className="rounded-md border border-border/70 bg-muted/40 p-3">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Also printed as exclusions, from the Scope step
    </p>
    <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
      {scopeExclusionLabels.map((label) => (
        <li key={label}>{label}</li>
      ))}
    </ul>
    <p className="mt-2 text-xs text-muted-foreground">
      Edit or remove these in the Scope step — the offer and tender print the
      combined list.
    </p>
  </div>
) : null}
```

Derive `scopeExclusionLabels` from a new `exclusions` prop:

```tsx
const scopeExclusionLabels = exclusions
  .filter((item) => item.includedInOfferDocument)
  .map((item) => item.label);
```

Add `exclusions: readonly OfferWorkspaceScopeItem[]` to `OfferDocumentEditorProps` and pass it from the caller alongside `lines` in Step 5.

- [ ] **Step 4c: Retitle the card**

The heading and description at `offer-workspace-document.tsx:52-56` say "one-pager copy", which is wrong — this card now drives a multi-page offer PDF **and** the tender:

```tsx
<OfferCardHeading
  description="Everything the client reads on the offer and the tender: headline, intro, the inclusions schedule, inclusion and exclusion bullets, and validity terms."
  icon={<FilePenLine className="size-4" aria-hidden="true" />}
  title="Offer & tender content"
/>
```

- [ ] **Step 5: Pass `lines` and `exclusions` from the caller**

In `components/offers/new-workflow/offer-workspace-screen.tsx`, find the `<OfferDocumentEditor` usage and add `lines={lines}` and `exclusions={exclusions}` (both already in scope for the cost-schedule and scope steps). Grep for `OfferDocumentEditor` to find every call site — there may be more than one.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts && pnpm exec tsc --noEmit && pnpm lint`
Expected: tests PASS 8/8, no type errors, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add components/offers/new-workflow/offer-workspace-document.tsx \
        components/offers/new-workflow/offer-workspace-screen.tsx \
        lib/offer/workspace-proposal-content.ts \
        tests/offer/inclusion-schedule.test.ts
git commit -m "feat(offers): edit inclusions schedule and exclusions in the offer document step"
```

---

## Task 3: One exclusion rule, one inclusion source, across every surface

**Files:**
- Modify: `lib/offer/workspace-print-template.ts:8`, `:44`, `:101`, `:187-199`
- Modify: `components/offers/new-workflow/offer-workspace-preview.tsx:138-141`, `:199-210`
- Modify: `components/offers/new-workflow/offer-workspace-tender.tsx:425-431`, `:463-473`
- Test: `tests/offer/inclusion-schedule.test.ts` (append)

**Interfaces:**
- Consumes: `OfferDocumentDraft.inclusionSchedule` (Task 1).
- Produces: `getVisibleExclusions(draft, exclusions): readonly string[]` becomes **exported** from `lib/offer/workspace-print-template.ts` (it is currently a private function at line 187). `OfferPrintTemplateData` no longer has `offerTenderLineItems`. `getIncludedOfferTenderLineItems` stays exported — Task 2's merge helper uses it.

**Why:** three surfaces apply three different rules today (see "The problem, stated precisely"). The PDF unions bullets with scope items; the offer preview ignores the bullets entirely; the tender treats the bullets as an override that suppresses scope items. Only the PDF's rule is correct, because it is the one the client receives — so it becomes the only rule. Separately, `workspace-print-template.ts:101` computes `offerTenderLineItems` and **nothing renders it** (confirmed by grep across all three renderers), so it goes.

- [ ] **Step 1: Write the failing test**

Append to `tests/offer/inclusion-schedule.test.ts`:

```ts
import {
  buildOfferPrintTemplateData,
  getVisibleExclusions,
} from "../../lib/offer/workspace-print-template";
import { INITIAL_EXCLUSIONS, INITIAL_OFFER_DRAFT } from "../../lib/offer/workspace-model";

test("visible exclusions union the draft bullets with the printed scope items", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Bullet only"] };
  const scopeItem = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-1",
    label: "Scope only",
    includedInOfferDocument: true,
  };

  const result = getVisibleExclusions(draft, [scopeItem]);

  assert.ok(result.includes("Bullet only"), "draft bullet must print");
  assert.ok(result.includes("Scope only"), "scope item must print");
});

test("a scope item hidden from the document does not print", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: [] };
  const hidden = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-2",
    label: "Hidden item",
    includedInOfferDocument: false,
  };

  assert.deepEqual(getVisibleExclusions(draft, [hidden]), []);
});

test("a label duplicated across a bullet and a scope item prints once", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Pool fencing"] };
  const dupe = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-3",
    label: "Pool fencing",
    includedInOfferDocument: true,
  };

  assert.deepEqual(getVisibleExclusions(draft, [dupe]), ["Pool fencing"]);
});

test("print template data no longer carries the dead derived line items", () => {
  assert.equal(
    "offerTenderLineItems" in
      (buildOfferPrintTemplateData(printTemplateInputFixture()) as object),
    false,
  );
});
```

Build `printTemplateInputFixture()` in the test file from the `INITIAL_*` constants — copy the fixture shape from `tests/offer/offer-proposal-pagination.test.ts:29-45` (`snapshotWithOwners`) and pass it through `buildProposalInput` from `lib/offer/offer-proposal-input.ts`, which is exactly how production builds this input.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — `getVisibleExclusions` is not exported, and the dead key is still present.

- [ ] **Step 3: Export the resolver, delete the dead field**

In `lib/offer/workspace-print-template.ts`:
- add `export` to `function getVisibleExclusions` at line 187 (behaviour unchanged — it is already correct)
- remove line 44 (`offerTenderLineItems`) from the `OfferPrintTemplateData` type
- remove line 101 from the returned object
- remove the now-unused import of `getIncludedOfferTenderLineItems` at line 8

- [ ] **Step 4: Point the offer preview at both shared sources**

In `components/offers/new-workflow/offer-workspace-preview.tsx`, delete lines 138-141 (`visibleExclusions` and `offerTenderLineItems`) plus their now-unused imports, and replace the two lists at lines 199-210:

```tsx
<PreviewList
  items={draft.inclusionSchedule}
  title="Inclusions schedule"
/>
<PreviewList
  items={getVisibleExclusions(draft, exclusions)}
  title="Exclusions"
/>
```

Import `getVisibleExclusions` from `@/lib/offer/workspace-print-template`.

- [ ] **Step 5: Point the tender surface at the same sources**

In `components/offers/new-workflow/offer-workspace-tender.tsx`, replace the fallback logic at lines 425-431 with the shared resolver:

```tsx
const exclusionLines = getVisibleExclusions(draft, exclusions);
```

Then fix the inclusions list at lines 463-468 — it shows `inclusionBullets` while the tender PDF prints the schedule:

```tsx
<TenderList
  emptyLabel="No inclusions captured yet."
  items={draft.inclusionSchedule}
  numbered
  title="Inclusions"
/>
```

Import `getVisibleExclusions` and delete the now-unused `shownExclusions` local.

- [ ] **Step 6: Run tests, typecheck and lint**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS; no type or lint errors.

- [ ] **Step 7: Commit**

```bash
git add components/offers/new-workflow/offer-workspace-preview.tsx \
        components/offers/new-workflow/offer-workspace-tender.tsx \
        lib/offer/workspace-print-template.ts \
        tests/offer/inclusion-schedule.test.ts
git commit -m "fix(offers): one inclusion and exclusion rule across preview, tender and PDF"
```

---

## Task 4: Render the schedule as a numbered list on all three surfaces

**Files:**
- Modify: `lib/offer/offer-proposal-html.ts:42`, `:145-152`, `:450-472`
- Modify: `lib/offer/offer-tender-html.ts:37`, `:145-152`, `:229`, `:454-476`
- Modify: `components/offers/new-workflow/offer-workspace-print-template.tsx:66`, `:156-159`, `:574-625`
- Test: `tests/offer/inclusion-schedule.test.ts` (append)
- Modify: `tests/offer/offer-proposal-pagination.test.ts`, `tests/offer/offer-document-print-pages.test.ts`

**Interfaces:**
- Consumes: `OfferDocumentDraft.inclusionSchedule` (Task 1).
- Produces: no new exports. All three renderers stop importing `STANDARD_INCLUSIONS_SCHEDULE`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offer/inclusion-schedule.test.ts`:

```ts
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildTenderHtml } from "../../lib/offer/offer-tender-html";

test("the offer PDF prints the draft schedule, not the template constant", () => {
  const snapshot = snapshotWithSchedule(["Bespoke spec one", "Bespoke spec two"]);
  const html = buildProposalHtml(buildProposalInput(snapshot), snapshot.job);

  assert.match(html, /Bespoke spec one/);
  assert.match(html, /Bespoke spec two/);
  assert.doesNotMatch(html, /Engineered slab/);
});

test("the offer PDF drops the Category column heading", () => {
  const snapshot = snapshotWithSchedule(["Only spec"]);
  const html = buildProposalHtml(buildProposalInput(snapshot), snapshot.job);

  assert.doesNotMatch(html, /<th>Category<\/th>/);
  assert.doesNotMatch(html, /<th>Specification<\/th>/);
});

test("the tender prints the draft schedule and drops its column headings", () => {
  const snapshot = snapshotWithSchedule(["Tender spec"]);
  const html = buildTenderHtml(buildProposalInput(snapshot), snapshot.job);

  assert.match(html, /Tender spec/);
  assert.doesNotMatch(html, /<th>Category<\/th>/);
  assert.doesNotMatch(html, /<th>Status<\/th>/);
});

test("an empty schedule renders no inclusions page at all", () => {
  const snapshot = snapshotWithSchedule([]);
  const html = buildProposalHtml(buildProposalInput(snapshot), snapshot.job);

  assert.doesNotMatch(html, /Full inclusions schedule/);
});
```

Add a `snapshotWithSchedule(schedule: string[])` helper to the test file, modelled on `snapshotWithOwners` in `tests/offer/offer-proposal-pagination.test.ts:29-45`, overriding `draft: { ...INITIAL_OFFER_DRAFT, inclusionSchedule: schedule }`. Read the real signatures of `buildProposalHtml` / `buildTenderHtml` before writing the calls — the second argument shown here is a guess and must be verified against the source.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — the template constant still renders, and the `<th>` headings are still present.

- [ ] **Step 3: Convert the offer PDF renderer**

In `lib/offer/offer-proposal-html.ts`, replace `inclusionsPage` (lines 450-472). Note the `<ol start>` so numbering continues across pages:

```ts
function inclusionsPage(
  specifications: readonly string[],
  startIndex: number,
  continued: boolean,
  foot: string,
): string {
  const body = specifications
    .map((spec) => `<li>${esc(spec)}</li>`)
    .join("");
  const intro = continued
    ? ""
    : `<p class="muted" style="margin-top:12px;max-width:155mm;">All items below are fixed within your contract price. Design provided by owner/architect — all costs fixed as per approved plans, confirmed at colour selection.</p>`;
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Inclusions</div>
    <h1 class="title">Full inclusions schedule${continued ? " (cont.)" : ""}</h1>
    ${intro}
    <ol class="inc" start="${startIndex + 1}">${body}</ol>
    ${foot}
  </div>`;
}
```

Update the chunking at lines 145-152 to page `input.draft.inclusionSchedule` instead of `STANDARD_INCLUSIONS_SCHEDULE`, pass `index * INCLUSIONS_ROWS_PER_PAGE` as `startIndex`, and remove the `STANDARD_INCLUSIONS_SCHEDULE` import at line 13. **When the schedule is empty, emit no inclusions page** — guard the chunk loop so a zero-length list produces zero pages (the last test in Step 1 pins this).

Replace the `table.inc` CSS rule with list styling. Find the existing `.inc` block in the stylesheet and swap it for:

```css
ol.inc{margin-top:18px;padding-left:20px;max-width:165mm;}
ol.inc li{margin-bottom:9px;line-height:1.5;color:${MUTED};}
```

- [ ] **Step 4: Convert the tender renderer**

In `lib/offer/offer-tender-html.ts`, replace `inclusionsPage` (lines 454-476). It already receives `startIndex` (threaded at line 229) — keep that:

```ts
function inclusionsPage(
  specifications: readonly string[],
  startIndex: number,
  continued: boolean,
  foot: string,
): string {
  const body = specifications
    .map((spec) => `<li>${esc(spec)}</li>`)
    .join("");
  const intro = continued
    ? ""
    : `<p style="color:${MUTED};">All items below are included in the Contract Sum and fixed as per the approved plans and specifications, confirmed at colour selection.</p>`;
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Scope of Works — Inclusions Schedule${continued ? " (cont.)" : ""}</h2>
    ${intro}
    <ol start="${startIndex + 1}">${body}</ol>
    ${foot}
  </div>`;
}
```

The per-row `Included` status pill is dropped — the intro sentence already states that everything listed is in the Contract Sum, and the old column said `Included` on every single row. Update the chunking at lines 145-152 to use `input.draft.inclusionSchedule`, remove the import at line 7, and guard the empty case as in Step 3.

- [ ] **Step 5: Convert the print template**

In `components/offers/new-workflow/offer-workspace-print-template.tsx`, replace `PrintInclusionsPage` (lines 574-625):

```tsx
function PrintInclusionsPage({
  specifications,
  startIndex,
  continued,
  footer,
}: {
  readonly specifications: readonly string[];
  readonly startIndex: number;
  readonly continued: boolean;
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Inclusions"
        title={continued ? "Full inclusions schedule (cont.)" : "Full inclusions schedule"}
      >
        {continued ? null : (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            All items below are fixed within your contract price. Design provided
            by owner/architect — all costs fixed as per approved plans, confirmed
            at colour selection.
          </p>
        )}
      </PrintSection>
      <ol
        className="mt-6 max-w-[165mm] list-decimal pl-5 text-sm"
        start={startIndex + 1}
      >
        {specifications.map((spec, index) => (
          <li
            key={`${startIndex + index}`}
            className="mb-2 leading-6 text-muted-foreground"
          >
            {spec}
          </li>
        ))}
      </ol>
    </PrintPage>
  );
}
```

Update the `chunk(...)` call at lines 156-159 to chunk `data.draft.inclusionSchedule` (or `props.draft.inclusionSchedule` — check which is in scope), remove the `STANDARD_INCLUSIONS_SCHEDULE` and `OfferInclusionRow` imports at lines 22-24, thread `startIndex`, and guard the empty case.

- [ ] **Step 6: Retune pagination and fix the page-count tests**

`INCLUSIONS_ROWS_PER_PAGE = 12` was sized for two-column table rows. A full-width numbered list of the same sentences is more compact — the ~45mm category column is gone, so each entry wraps less. Raise it to `16` in all three files (`offer-proposal-html.ts:42`, `offer-tender-html.ts:37`, `offer-workspace-print-template.tsx:66`).

Run: `pnpm test`
Expected: FAIL in `tests/offer/offer-proposal-pagination.test.ts` and `tests/offer/offer-document-print-pages.test.ts` — the 44 seeded specifications now paginate 16/16/12 (3 pages) instead of 12/12/12/8 (4 pages), so asserted total page counts and footer `Page N of M` strings shift by one.

Read each failing assertion and update the expected numbers to match. **Do not** loosen an assertion to make it pass — these tests exist to pin the footer total against the real page count, and a wrong total is a visible defect on a contract document.

- [ ] **Step 7: Verify the rendered PDF, not just the HTML string**

Print CSS regressions do not show up in `renderToStaticMarkup` assertions — a list that overflows its page silently produces a 4th page the footer does not count. Render the offer to an actual PDF and look at it.

Run the app (`pnpm dev`), open an offer, and use the existing print/preview path to produce a PDF; or drive it headless with the `browse` skill against the print route. Confirm, on the real output:
- every inclusions page is full but not overflowing
- numbering runs 1..N unbroken across page breaks
- the footer `Page N of M` total matches the actual page count
- the intro paragraph appears once, on the first inclusions page only

If any page overflows, lower `INCLUSIONS_ROWS_PER_PAGE` and repeat Step 6.

- [ ] **Step 8: Run the full suite**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/offer/offer-proposal-html.ts lib/offer/offer-tender-html.ts \
        components/offers/new-workflow/offer-workspace-print-template.tsx \
        tests/offer/inclusion-schedule.test.ts \
        tests/offer/offer-proposal-pagination.test.ts \
        tests/offer/offer-document-print-pages.test.ts
git commit -m "feat(offers): render the inclusions schedule as a numbered list from the draft"
```

---

## Task 5: Record the decision

**Files:**
- Create: `docs/adr/0006-per-offer-inclusion-schedule.md`

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1-4.
- Produces: nothing code-facing.

- [ ] **Step 1: Write the ADR**

Follow the structure of `docs/adr/0005-offer-content-editable-after-send.md` (Status / Context / Decision / Consequences). Cover:

- **Context:** the schedule was a module constant imported by three renderers; the preview showed a cost-line-derived list while the PDF showed `inclusionBullets`, so the preview never showed what was sent; `workspace-proposal-content.ts:15-29` already documents an earlier drift between the bullets and the schedule (60mm vs 40mm stone), which `OFFER_SPEC_FACTS` patched at the constant level without making the content editable.
- **Decision:** the schedule is per-offer editable copy on `OfferDocumentDraft`, seeded from the template, persisted in the snapshot, rendered as a plain numbered list; `mergeCostScheduleIntoSchedule` is the explicit, estimator-triggered link from priced cost lines to customer wording.
- **Consequences:** the `Category` column and the `highlight` emphasis are gone; a sent offer freezes its schedule (ADR 0002/0005 snapshot model), so re-rendering a historical revision reproduces what the client received; v2→v3 migration seeds pre-existing offers from the template; AI generation of the schedule was **considered and deferred** — the specification text is contractually binding inside a fixed-price MBA contract, and `offer-prefill-ai.ts:90-97` already forbids the model from inventing construction details for that reason.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0006-per-offer-inclusion-schedule.md
git commit -m "docs(adr): record per-offer inclusion schedule decision"
```

---

## Self-Review Notes

**Core statement — "the inclusions and exclusions that are part of the offer and tender must be editable in the Offer phase":**

| Printed content | Editable after this plan | Where |
|---|---|---|
| Offer "This price includes" | ✅ already was | Step 5 |
| Offer "Full inclusions schedule" | ✅ **new** | Step 5 (Task 1+2) |
| Tender "Scope of Works — Inclusions Schedule" | ✅ **new** — same field | Step 5 (Task 1+2) |
| Offer "This price excludes" | ✅ **new** editor for the bullets half | Step 5 (Task 2) |
| Tender "Exclusions" | ✅ **new** — same field | Step 5 (Task 2) |
| Scope-sourced exclusions | ✅ already was, now **visible** from Step 5 | Step 4, surfaced in Step 5 (Task 2 Step 4b) |
| Allowances / prime-cost table | ✅ already was | Step 4 |

All of Step 4 and Step 5 stay editable through `sent` per ADR 0005, so this holds through the whole negotiation window.

**Other requirements from the originating session:**

- ✅ Per-offer, not admin-level (Q1 answer) — Task 1
- ✅ Template elements retained ("elements already defined as part of the template should also be there") — Task 1 seeds from `STANDARD_INCLUSION_SPECIFICATIONS`
- ✅ Category/Specification headings dropped, wording only ("we don't need to show that... just the specification") — Task 4
- ✅ Schedule built from the cost-schedule line items ("from this line item... the schedule would be created") — Task 2's `mergeCostScheduleIntoSchedule`
- ✅ Editable in the preview — Task 2 (editor) + Task 3 (every surface reflects it)
- ✅ No AI (Q2 answer) — deferred, with rationale recorded in Task 5

**Known gaps, deliberately out of scope:**

- **`job.buildScope` prints on the tender** (`offer-tender-html.ts:373`) but is edited in **Job setup**, which freezes at send per ADR 0005. So one line of tender scope text is *not* editable in the negotiation window. This is the one row of the audit table this plan does not close — closing it means either moving `buildScope` onto the draft or carving it out of the Job-setup freeze, both of which touch the pricing-freeze boundary and deserve their own decision. **Flag to the user before implementing.**
- The **welcome letter** (`buildWelcomeParagraphs`, `workspace-proposal-content.ts:293`) is still hard-coded. Same class of problem, worth a follow-up.
- **Admin-level defaults** were explicitly declined, so `AdminOfferContent` is unchanged. If Royal later wants to change the boilerplate without a deploy, that is an `inclusionsSchedule` field on `AdminOfferContent` plus a tab in `components/offers/admin/`, following the existing `offerContent` pattern.
- **`OFFER_SPEC_FACTS` drift** is no longer structurally prevented once an estimator edits either list. Accepted: it is now a human decision on a document a human reviews before sending.
