# Offer Document as Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the offer-copy form. Step 5 becomes the customer's document itself, edited in place, backed by **one** inclusions list that cannot contradict itself.

**Architecture:** Two changes that only make sense together. (1) `inclusionBullets` and `inclusionSchedule` collapse into one `inclusionSchedule: OfferInclusionEntry[]`, where each entry is `{ spec, summary? }` — the optional short form is what prints beside the price on page 4. (2) The Step 5 form card is replaced by an inline-editable rendering of the offer document; the narrow sidebar preview is removed. Nothing about pricing, persistence transport, or the PDF renderers' page structure changes.

**Tech Stack:** Next.js (App Router), TypeScript, Zod (snapshot schema v3 → v4), `node:test` via `tsx --test`, puppeteer for PDF verification.

## Why

Shipped on `feat/editable-offer-tender-inclusions`, Step 5 asks an estimator to fill five fields totalling ~65 lines, including a 42-line monospace textarea. Two of those fields — inclusion bullets and inclusions schedule — state the same facts at two lengths, maintained by hand.

That is not hypothetical drift. On a real offer today, page 4 reads `60mm stone benchtops throughout` and `Timber-look herringbone flooring` while pages 5–7 read `40mm engineered stone` and `600 x 1200 porcelain tiles`. Both print in the same fixed-price contract. The `60mm`/`herringbone` wording was removed from the codebase in `c2f0737` ("reconcile proposal specs"); the offer's saved bullets still carry it.

`OFFER_SPEC_FACTS` exists precisely to stop this, and it cannot help once both lists are free text a human edits separately. The only durable fix is to have one list.

## Global Constraints

- **This is NOT the Next.js you know.** Read `node_modules/next/dist/docs/` before touching routing, caching or data fetching. This plan touches none of them.
- **Test runner:** `pnpm test` → `tsx --test tests/*/*.test.ts`, using `node:test` + `node:assert/strict`.
- **ADR 0005 still governs editability.** The document canvas is the Offer document step: editable while `pending` **or** `sent`, locked after. Do not introduce a new lock.
- **Pricing is untouched.** No inclusion/exclusion text may enter `calculateDirectTotal` or any pricing path.
- **Page structure of the PDFs does not change.** Page 4 keeps "THIS PRICE INCLUDES" / "THIS PRICE EXCLUDES"; pages 5+ keep the numbered schedule. Only where the text *comes from* changes.
- **Exact literal headings** (unchanged): offer `Full inclusions schedule` / `(cont.)`; tender `Scope of Works — Inclusions Schedule` / `(cont.)`. Em dash.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/offer/workspace-proposal-content.ts` | Modify. `STANDARD_INCLUSION_SPECIFICATIONS` becomes `OfferInclusionEntry[]` carrying the summary labels; `OFFER_INCLUDES_BULLETS` is deleted. |
| `lib/offer/workspace-model.ts` | Modify. `OfferInclusionEntry` type; `inclusionBullets` removed from the draft; `mergeCostScheduleIntoSchedule` and `chunkInclusionSchedule` operate on entries. |
| `lib/offer/workspace-persistence.ts` | Modify. Entry schema + v3 → v4 migration. |
| `lib/offer/workspace-print-template.ts` | Modify. Add `summaryInclusions` derived from entries. |
| `lib/offer/offer-proposal-html.ts` | Modify. Page 4 reads `summaryInclusions`; schedule pages read `entry.spec`. |
| `lib/offer/offer-tender-html.ts` | Modify. Schedule pages read `entry.spec`. |
| `components/offers/new-workflow/offer-workspace-print-template.tsx` | Modify. Same two changes for the React print surface. |
| `components/offers/new-workflow/offer-document-canvas.tsx` | **Create.** The inline-editable document — Step 5's whole content. |
| `components/offers/new-workflow/offer-document-canvas-fields.tsx` | **Create.** `EditableText` / `EditableList` primitives used by the canvas. |
| `components/offers/new-workflow/offer-workspace-document.tsx` | **Delete.** The form card this replaces. |
| `components/offers/new-workflow/offer-workspace-preview.tsx` | **Delete.** The sidebar preview the canvas supersedes. |
| `components/offers/new-workflow/offer-workspace-screen.tsx` | Modify. Step 5 renders the canvas; the `<aside>` preview is removed. |
| `tests/offer/inclusion-schedule.test.ts` | Modify. Entry-shaped fixtures, v4 migration, summary derivation. |
| `docs/adr/0006-per-offer-inclusion-schedule.md` | Modify. Amend — this supersedes its two-list decision. |

---

## Task 1: One inclusions list with an optional summary label

**Files:**
- Modify: `lib/offer/workspace-proposal-content.ts`, `lib/offer/workspace-model.ts`, `lib/offer/workspace-persistence.ts`
- Test: `tests/offer/inclusion-schedule.test.ts`

**Interfaces:**
- Produces: `type OfferInclusionEntry = { readonly spec: string; readonly summary?: string }`; `STANDARD_INCLUSION_ENTRIES: readonly OfferInclusionEntry[]`; `getSummaryInclusions(entries): readonly string[]`; `migrateV3ToV4`.
- Removes: `OfferDocumentDraft.inclusionBullets`, `OFFER_INCLUDES_BULLETS`, `STANDARD_INCLUSION_SPECIFICATIONS`.

**Why v4 and not amending v3:** v3 is committed but unmerged, so it never shipped — but the developer's local database already holds v3 snapshots from testing. A v3 → v4 migration costs one function and handles both; silently changing v3's shape would corrupt those snapshots on read.

- [ ] **Step 1: Write the failing test**

Replace the schedule-shaped assertions in `tests/offer/inclusion-schedule.test.ts` and add:

```ts
test("every summary label belongs to an entry that also carries a spec", () => {
  for (const entry of STANDARD_INCLUSION_ENTRIES) {
    assert.ok(entry.spec.trim().length > 0, "every entry needs a spec");
    if (entry.summary !== undefined) {
      assert.ok(entry.summary.trim().length > 0, "a summary, if present, must be non-empty");
    }
  }
});

test("the page 4 list is exactly the entries carrying a summary, in order", () => {
  const entries = [
    { spec: "Full spec A", summary: "Short A" },
    { spec: "Full spec B" },
    { spec: "Full spec C", summary: "Short C" },
  ];

  assert.deepEqual(getSummaryInclusions(entries), ["Short A", "Short C"]);
});

test("v3 snapshots migrate to v4, folding the old bullets away", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 3,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: ["60mm stone benchtops throughout"],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: ["40mm engineered stone — kitchen island."],
    },
  }) as {
    schemaVersion: number;
    draft: { inclusionSchedule: OfferInclusionEntry[]; inclusionBullets?: unknown };
  };

  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.draft.inclusionSchedule, [
    { spec: "40mm engineered stone — kitchen island." },
  ]);
  assert.equal(
    migrated.draft.inclusionBullets,
    undefined,
    "the stale bullet list must not survive — it is the contradiction we are removing",
  );
});

test("v2 snapshots migrate straight through to v4 seeded from the template", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: { headline: "H", introText: "I", inclusionBullets: [], exclusionBullets: [], termsSummary: "T" },
  }) as { schemaVersion: number; draft: { inclusionSchedule: OfferInclusionEntry[] } };

  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.draft.inclusionSchedule, STANDARD_INCLUSION_ENTRIES);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — `STANDARD_INCLUSION_ENTRIES` / `getSummaryInclusions` not exported.

- [ ] **Step 3: Rewrite the seed as entries, hand-mapping the summary labels**

In `lib/offer/workspace-proposal-content.ts`, replace `STANDARD_INCLUSION_SPECIFICATIONS` and delete `OFFER_INCLUDES_BULLETS`. Each of today's 14 bullets becomes the `summary` on its matching schedule row. **This mapping is content work — do it by hand, do not automate it.** The correspondence:

| Today's bullet (page 4) | Attach as `summary` to the row with `category` |
|---|---|
| All structural works — slab, frame, roof | Concrete Slab |
| Full render to ALL elevations — both levels | Rendering — Full Facade |
| All plumbing & electrical to completion | Electrical |
| Luxury shaker kitchen + butler's pantry | Kitchen Cabinetry |
| `${OFFER_SPEC_FACTS.stoneBenchtopThickness} stone benchtops throughout` | Stone Benchtops |
| `${OFFER_SPEC_FACTS.ductedAirConditioning} ducted air conditioning` | Ducted Air Con |
| `${OFFER_SPEC_FACTS.livingFloorFinish} — living areas` | Flooring — Living |
| Floor-to-ceiling tiles — all wet areas | Tiling |
| Feature staircase with glass balustrade | Staircase |
| Driveway — both vehicle crossings | Driveway |
| HBCF home warranty insurance | HBCF |
| Final clean & defects period | Final Clean |

Two bullets have **no** schedule row — `All PC items per inclusions schedule` and `Council certifier and approval fees`. Add them as new entries carrying both a `spec` and a `summary`, so page 4 keeps all 14 items:

```ts
{
  spec: "All prime-cost and provisional-sum items as listed in this schedule, confirmed at colour selection.",
  summary: "All PC items per inclusions schedule",
},
{
  spec: "Council certifier fees, development application and construction certificate approval fees.",
  summary: "Council certifier and approval fees",
},
```

Keep `OFFER_SPEC_FACTS` interpolation in the summaries. It is now belt-and-braces rather than the only defence — the two lists are one list — but a shared constant still beats two literals.

- [ ] **Step 4: Add the type, the derivation, and drop the bullets from the draft**

In `lib/offer/workspace-model.ts`:

```ts
// One inclusion, stated once. `spec` is the contractual sentence printed in the
// Inclusions Schedule. `summary` is the optional short form printed beside the
// price on the Investment Summary page — present only on the items worth
// selling on. Two hand-maintained lists is what let page 4 promise 60mm stone
// while page 6 promised 40mm; there is now only one place to say it.
export type OfferInclusionEntry = {
  readonly spec: string;
  readonly summary?: string;
};

export function getSummaryInclusions(
  entries: readonly OfferInclusionEntry[],
): readonly string[] {
  return entries
    .map((entry) => entry.summary?.trim())
    .filter((summary): summary is string => Boolean(summary));
}
```

Change `OfferDocumentDraft.inclusionSchedule` to `readonly OfferInclusionEntry[]` and **delete `inclusionBullets`**. Update `INITIAL_OFFER_DRAFT` to seed from `STANDARD_INCLUSION_ENTRIES`.

Update `mergeCostScheduleIntoSchedule` to compare against `entry.spec` and append `{ spec: wording }` (no summary — cost-schedule wording is contractual, not a sales line). Update `chunkInclusionSchedule` to measure `entry.spec` with `CHARS_PER_LINE_INCLUSION`.

- [ ] **Step 5: Schema and migration**

In `lib/offer/workspace-persistence.ts`, bump `CURRENT_WORKSPACE_SCHEMA_VERSION` to `4`, replace the schedule field, and drop `inclusionBullets`:

```ts
const inclusionEntrySchema = z.object({
  spec: z.string(),
  summary: z.string().optional(),
});

const draftSchema = z.object({
  headline: z.string(),
  introText: z.string(),
  exclusionBullets: z.array(z.string()),
  inclusionSchedule: z.array(inclusionEntrySchema).default([]),
  termsSummary: z.string(),
});
```

Chain the migration after v2→v3 (`if (version < 4) next = migrateV3ToV4(next)`):

```ts
// v3 → v4: the two inclusion lists become one. v3 stored inclusionSchedule as
// plain strings alongside a separately-edited inclusionBullets array; the two
// had already contradicted each other in real offers (page 4 "60mm stone" vs
// page 6 "40mm engineered stone"). The SCHEDULE wins — it is the contractual
// statement — and the stale bullets are dropped rather than migrated onto
// summaries, because there is no reliable way to tell which of two conflicting
// claims the estimator meant. The estimator re-adds summary labels in the
// canvas, seeing both the spec and the label as they type.
function migrateV3ToV4(state: Record<string, unknown>): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const { inclusionBullets: _dropped, ...rest } = draft;
  const schedule = Array.isArray(draft.inclusionSchedule)
    ? draft.inclusionSchedule
    : [];
  return {
    ...state,
    schemaVersion: 4,
    draft: {
      ...rest,
      inclusionSchedule: schedule.map((entry) =>
        typeof entry === "string" ? { spec: entry } : entry,
      ),
    },
  };
}
```

Thread the entry shape through `serializeWorkspace`.

**Flag for the user at review:** dropping the v3 bullets means an offer whose page-4 list was hand-tuned loses that tuning and page 4 falls back to whatever summaries exist. Given the alternative is silently preserving text known to contradict the schedule inside a fixed-price contract, dropping is the safer default — but it is a judgement call, and the seeded template restores 14 sensible summaries for any offer that never diverged.

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts && pnpm exec tsc --noEmit`
Expected: tests PASS; the typecheck lists every remaining `inclusionBullets` reference. Fix each — they are the renderers, handled in Task 2.

- [ ] **Step 7: Commit**

```bash
git add lib/offer tests/offer/inclusion-schedule.test.ts
git commit -m "feat(offers): collapse the two inclusion lists into one entry list"
```

---

## Task 2: Renderers read entries; page 4 reads the summaries

**Files:**
- Modify: `lib/offer/workspace-print-template.ts`, `lib/offer/offer-proposal-html.ts`, `lib/offer/offer-tender-html.ts`, `components/offers/new-workflow/offer-workspace-print-template.tsx`
- Test: `tests/offer/inclusion-schedule.test.ts`

**Interfaces:**
- Consumes: `OfferInclusionEntry`, `getSummaryInclusions` (Task 1).
- Produces: `OfferPrintTemplateData.summaryInclusions: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
test("page 4 prints the summary labels, the schedule prints the specs", () => {
  const entries = [
    { spec: "Long contractual sentence about stone.", summary: "Stone benchtops" },
    { spec: "Long contractual sentence about tiling." },
  ];
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule(entries)),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /Stone benchtops/, "summary belongs on the investment page");
  assert.match(html, /Long contractual sentence about tiling\./, "spec belongs in the schedule");
});

test("an entry with no summary never reaches the investment page", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule([{ spec: "Schedule only, no summary." }])),
    EMPTY_OFFER_IMAGES,
  );
  const investmentPage = html.split('class="page"').find((p) => p.includes("Investment summary")) ?? "";

  assert.doesNotMatch(investmentPage, /Schedule only, no summary\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — page 4 still reads the deleted `inclusionBullets`.

- [ ] **Step 3: Derive `summaryInclusions` once**

In `lib/offer/workspace-print-template.ts` add to `OfferPrintTemplateData` and to the returned object:

```ts
summaryInclusions: getSummaryInclusions(draft.inclusionSchedule),
```

Derive it here, not in each renderer — the three renderers have drifted before.

- [ ] **Step 4: Point the three renderers at the new fields**

- `offer-proposal-html.ts` `investmentPage`: `const includes = data.summaryInclusions.map(...)`.
- `offer-proposal-html.ts` `inclusionsPage`: `specifications.map((entry) => ...esc(entry.spec)...)`.
- `offer-tender-html.ts` `inclusionsPage`: same `entry.spec` change. The tender has no investment page — no summary change there.
- `offer-workspace-print-template.tsx`: `PrintInvestmentPage` uses `data.summaryInclusions`; `PrintInclusionsPage` renders `entry.spec`.

- [ ] **Step 5: Verify against real PDFs, not HTML strings**

Regenerate and render through puppeteer with the production options (`format: "A4", printBackground: true`), then confirm with `pdfinfo` that declared `.page` divs equal actual PDF pages, for both the seeded schedule and a 30-entry stress set of three-line specs. Height-based chunking from the previous change must still hold with the entry shape.

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/offer components/offers/new-workflow/offer-workspace-print-template.tsx tests/offer/inclusion-schedule.test.ts
git commit -m "feat(offers): page 4 prints inclusion summaries, schedule prints specs"
```

---

## Task 3: The document canvas replaces the form and the sidebar

**Files:**
- Create: `components/offers/new-workflow/offer-document-canvas-fields.tsx`
- Create: `components/offers/new-workflow/offer-document-canvas.tsx`
- Delete: `components/offers/new-workflow/offer-workspace-document.tsx`, `components/offers/new-workflow/offer-workspace-preview.tsx`
- Modify: `components/offers/new-workflow/offer-workspace-screen.tsx`

**Interfaces:**
- Consumes: `OfferDocumentDraft` with entry-shaped `inclusionSchedule` (Task 1); `getVisibleExclusions`; `mergeCostScheduleIntoSchedule`.
- Produces: `<OfferDocumentCanvas draft exclusions lines job customerPrice ... onDraftChange />` — Step 5's entire content.

**Design constraints, decided:**

1. **Use `<textarea>`/`<input>` styled to look like the document, not `contentEditable`.** `contentEditable` accepts pasted HTML, fights React's reconciliation, and would put rich markup into text that ends up in a contract PDF. Styling a real form control to look like document text gets the same feel with none of that.
2. **Step 5 is full-width; the `<aside>` preview is removed.** `PricingSummary` remains for steps 1–4. The canvas supersedes the sidebar rather than sitting beside it.
3. **The canvas is not the print template.** `offer-workspace-print-template.tsx` stays untouched as the pixel-accurate print/PDF surface. The canvas mirrors its structure at screen width; it does not try to be page-accurate. Trying to make one component do both is how the PDF gets broken by a CSS change.

- [ ] **Step 1: Build the editable primitives**

`offer-document-canvas-fields.tsx`:

```tsx
"use client";

// A text field that reads as document copy, not as a form input: no border or
// background until hovered/focused. Deliberately a real <textarea>, never
// contentEditable — this text is printed into a fixed-price contract, and
// contentEditable accepts pasted markup.
export function EditableText({ value, onChange, className, ariaLabel, rows }: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly className?: string;
  readonly ariaLabel: string;
  readonly rows?: number;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      className={cn(
        "w-full resize-none rounded-sm border border-transparent bg-transparent p-1",
        "hover:border-border/70 hover:bg-muted/30",
        "focus:border-royal-gold/60 focus:bg-white focus:outline-none",
        className,
      )}
      onChange={(event) => onChange(event.target.value)}
      rows={rows ?? 1}
      value={value}
    />
  );
}
```

Add `EditableInclusionRow` — one schedule entry rendered as its printed line, with the spec inline and a summary affordance:

```tsx
// The summary is the ONLY thing that reaches page 4, so it is edited right next
// to the spec it summarises. An entry with no summary shows a muted
// "+ show beside price" affordance rather than an empty field, so the schedule
// does not read as 42 half-filled forms.
export function EditableInclusionRow({ entry, index, onChange, onRemove }: {...}) { ... }
```

- [ ] **Step 2: Build the canvas**

`offer-document-canvas.tsx` mirrors the document's real order, each block editable in place:

1. Reference / client / site (read-only — these come from Job setup)
2. **Headline** — `EditableText`, document `h1` styling
3. **Intro** — `EditableText`
4. Fixed price block (read-only — from Pricing)
5. **"This price includes"** — read-only, derived; a note says these are the summary labels from the schedule below
6. **"This price excludes"** — `EditableList` over `exclusionBullets`, with scope-sourced exclusions shown inline and muted, labelled as coming from the Scope step
7. **Inclusions schedule** — `EditableInclusionRow` per entry, add/remove, plus the "Pull wording from cost schedule" action
8. **Terms** — `EditableText`

Section 5 being derived and read-only is the whole point: you cannot edit page 4 into disagreeing with the schedule, because page 4 is not a thing you edit.

- [ ] **Step 3: Wire Step 5 and delete the old components**

In `offer-workspace-screen.tsx`: replace `<OfferDocumentEditor …/>` with `<OfferDocumentCanvas …/>`, keep `<OfferWorkspaceImages/>` beneath it, and delete the `<OfferDocumentPreview …/>` block plus its import from the `<aside>`. Then delete both old component files.

- [ ] **Step 4: Verify in the running app**

`pnpm dev`, open an existing offer, Step 5. Confirm: the document reads as a document; editing a spec updates it in place; a summary label change is reflected in the read-only "This price includes" block immediately; "Pull wording from cost schedule" appends specs without summaries; the printed PDF matches what the canvas showed.

- [ ] **Step 5: Run everything and commit**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`

```bash
git add components/offers/new-workflow
git commit -m "feat(offers): edit the offer document in place, replacing the copy form"
```

---

## Task 4: Amend ADR 0006

**Files:**
- Modify: `docs/adr/0006-per-offer-inclusion-schedule.md`

- [ ] **Step 1: Amend, don't rewrite**

Add a "Superseded in part" note under Status and a new section recording:

- Two hand-maintained lists was the wrong call, and the evidence is a real offer whose page 4 promised `60mm stone` / `herringbone` while pages 5–7 promised `40mm engineered stone` / `600 x 1200 porcelain tiles`.
- One entry list with an optional summary replaces it; page 4 is derived and not editable.
- The form is replaced by in-place editing on the document; the sidebar preview is gone.
- `contentEditable` was rejected — pasted markup must never reach contract text.
- v3 → v4 drops the stale bullets rather than migrating them onto summaries, because there is no reliable way to tell which of two conflicting claims was intended.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0006-per-offer-inclusion-schedule.md
git commit -m "docs(adr): supersede the two-list inclusion decision"
```

---

## Self-Review Notes

**Against the requirement — "too much information to fill in":**

| Before | After |
|---|---|
| 5 form fields, ~65 lines | Document with 4 editable regions |
| Inclusion bullets (14 lines, hand-typed) | Derived from the schedule; not editable |
| Inclusions schedule (42-line monospace textarea) | Editable rows on the document, in place |
| Exclusion bullets + separate scope list | One exclusions block, scope items shown inline |
| Edit in a form, check a narrow sidebar | Edit the document you are sending |

**Open risks, flagged rather than hidden:**

- **The v3 bullet drop is lossy.** Documented in Task 1 Step 5 and the ADR; needs the user's explicit sign-off before merge.
- **Page 4 stops being directly editable.** That is deliberate — it is what removes the contradiction — but if Royal ever wants a page-4 line with no schedule counterpart, they must add a schedule entry for it. The two orphan bullets (PC items, council fees) are handled by giving them real schedule entries in Task 1 Step 3.
- **Two branches are now in flight.** This plan builds on `feat/editable-offer-tender-inclusions`, which is unmerged and itself awaiting `/code-review ultra`. Decide whether to merge that first or fold this in before review.
- **Still unaddressed** (unchanged from ADR 0006): `job.buildScope` prints on the tender but freezes at send; the welcome letter remains hard-coded.
