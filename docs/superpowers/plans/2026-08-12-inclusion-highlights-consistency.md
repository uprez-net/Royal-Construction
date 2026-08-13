# Inclusion Highlights + Consistency Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "This price includes" becomes its own short list of selling lines, and an AI check keeps it honest against the 63-row contractual schedule — instead of a per-row label the estimator maintains by hand.

**Architecture:** `summary` is removed from `OfferInclusionEntry` and replaced by `draft.inclusionHighlights: string[]`. The relationship between the two lists is **one-to-many** ("All structural works — slab, frame, roof" covers six schedule rows), so it is not modelled as a link at all; consistency is verified on demand by an AI check and surfaced as a `warn`-severity send blocker. AI drafts highlights from the schedule, checks them against it, and — on explicit approval only — drafts a schedule row for a highlight nothing supports.

**Tech Stack:** AI SDK v6 via the existing Vercel AI Gateway (`lib/model.ts`), `generateText` + `Output.object` on `google/gemini-2.5-flash`, Zod schemas, `node:test` via `tsx --test`.

## Why the current shape is wrong

`summary` sits on a single `OfferInclusionEntry`, which forces one selling line to belong to exactly one contract row. Verified against offer `RC-Q-2026-010-R2`: the line **"All structural works — slab, frame, roof"** is linked to row #2 (Concrete Slab) alone, while plainly covering

```
#3  Frame           Double storey structural timber frame — steel beams, lintels…
#4  Roof            Colorbond metal roofing — full hip/gable profile…
#5  Roof Trusses    Engineered prefabricated roof trusses…
#56 Concrete Slab   Excavation, structural piering, perimeter formwork…
#59 Timber Framing  Prefabricated timber wall frames, floor joists…
```

One selling line, six contract rows. Modelling that as a per-row field is what produced the double entry, the nested label-over-spec block, and the "mapping is not looking good" reaction.

Two lists are correct. What was wrong the *first* time was that they were unlinked free text that drifted (page 4 promising `60mm` stone while page 6 promised `40mm`). The fix is not to merge them — it is to check them.

## Global Constraints

- **This is NOT the Next.js you know.** Read `node_modules/next/dist/docs/` before touching routing, caching or data fetching. This plan touches none of them.
- **Test runner:** `pnpm test` → `tsx --test tests/*/*.test.ts`, `node:test` + `node:assert/strict`.
- **The model never writes a spec unapproved.** A spec is the contractual sentence inside a fixed-price MBA contract. Drafting one for an unsupported highlight is permitted (Task 4) but **only** behind an explicit, non-skippable approval step. Everything else the model writes is derived: a shortening of, or a judgement about, text the human already committed to.
- **ADR 0005 still governs editability.** Highlights live on the Offer document step: editable while `pending` **or** `sent`.
- **Existing send-blocker model is reused.** `OfferSendBlocker` already has `severity: "block" | "warn"` (`lib/offer/offer-readiness.ts:73`). A consistency mismatch is `warn`, never `block` — a false positive from the model must not stop a live deal going out.
- **Exact literal heading, unchanged:** `This price includes`.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/offer/workspace-model.ts` | Modify. `OfferInclusionEntry` loses `summary`/`summaryFromSpec`; draft gains `inclusionHighlights`. Staleness helpers deleted. |
| `lib/offer/workspace-persistence.ts` | Modify. v5 → v6 migration lifting summaries into `inclusionHighlights`. |
| `lib/offer/inclusion-copy-ai.ts` | Rewrite. Three jobs: draft highlights, check consistency, draft one schedule row. |
| `lib/data/offer-inclusion-copy.ts` | Modify. Server actions for the three jobs, auth unchanged. |
| `lib/offer/offer-readiness.ts` | Modify. Accept unresolved-mismatch count, emit a `warn` blocker. |
| `lib/offer/workspace-print-template.ts` | Modify. `summaryInclusions` reads `draft.inclusionHighlights`. |
| `components/offers/new-workflow/offer-document-canvas.tsx` | Modify. Highlights become an editable list with Draft/Check actions; star toggle removed from the schedule. |
| `components/offers/new-workflow/offer-inclusion-check-panel.tsx` | **Create.** Findings list, per-finding resolve/approve. |
| `tests/offer/inclusion-schedule.test.ts` | Modify. Highlight model, migration, readiness. |
| `tests/offer/offer-document-canvas.test.ts` | Modify. Canvas assertions for the new shape. |

---

## Task 1: Highlights become their own list

**Files:**
- Modify: `lib/offer/workspace-model.ts`, `lib/offer/workspace-persistence.ts`, `lib/offer/workspace-print-template.ts`
- Test: `tests/offer/inclusion-schedule.test.ts`

**Interfaces:**
- Produces: `OfferDocumentDraft.inclusionHighlights: readonly string[]`; `migrateV5ToV6`.
- Removes: `OfferInclusionEntry.summary`, `.summaryFromSpec`, `getSummaryInclusions`, `inclusionSummaryState`, `staleSummaryIndexes`, `inclusionCopyRequests`, `pendingInclusionCopyCount`, `applyInclusionCopyPatches`, `InclusionSummaryState`, `InclusionCopyPatch`.

- [ ] **Step 1: Write the failing test**

```ts
test("v5 summaries become the highlight list, in schedule order", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 5,
    job: {},
    draft: {
      headline: "H", introText: "I", exclusionBullets: [], termsSummary: "T",
      inclusionSchedule: [
        { spec: "Engineered slab.", summary: "All structural works", category: "Concrete Slab" },
        { spec: "Timber frame." },
        { spec: "40mm stone.", summary: "40mm stone benchtops", summaryFromSpec: "40mm stone." },
      ],
    },
  }) as {
    schemaVersion: number;
    draft: {
      inclusionHighlights: string[];
      inclusionSchedule: { spec: string; summary?: unknown; summaryFromSpec?: unknown }[];
    };
  };

  assert.equal(migrated.schemaVersion, 6);
  assert.deepEqual(migrated.draft.inclusionHighlights, [
    "All structural works",
    "40mm stone benchtops",
  ]);
  for (const entry of migrated.draft.inclusionSchedule) {
    assert.equal(entry.summary, undefined, "summary must not survive on the entry");
    assert.equal(entry.summaryFromSpec, undefined);
  }
  assert.equal(migrated.draft.inclusionSchedule[0].spec, "Engineered slab.");
});

test("a v5 offer with no summaries migrates to an empty highlight list", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 5, job: {},
    draft: { headline: "H", introText: "I", exclusionBullets: [], termsSummary: "T",
      inclusionSchedule: [{ spec: "Only a spec." }] },
  }) as { draft: { inclusionHighlights: string[] } };

  assert.deepEqual(migrated.draft.inclusionHighlights, []);
});

test("page 4 prints the highlight list verbatim", () => {
  const data = buildOfferPrintTemplateData(
    printInputWith({ inclusionHighlights: ["Full render to ALL elevations"] }),
  );
  assert.deepEqual(data.summaryInclusions, ["Full render to ALL elevations"]);
});

test("a blank highlight never prints", () => {
  const data = buildOfferPrintTemplateData(
    printInputWith({ inclusionHighlights: ["Real line", "   "] }),
  );
  assert.deepEqual(data.summaryInclusions, ["Real line"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test tests/offer/inclusion-schedule.test.ts`
Expected: FAIL — `inclusionHighlights` does not exist.

- [ ] **Step 3: Reshape the model**

In `lib/offer/workspace-model.ts`:

```ts
// One inclusion as it appears in the CONTRACTUAL schedule. No selling copy: a
// selling line routinely covers several of these ("All structural works — slab,
// frame, roof" stands for six rows), so a per-row label could never hold the
// relationship and forced the estimator to maintain it by hand.
export type OfferInclusionEntry = {
  readonly spec: string;
  readonly category?: string;
};
```

On `OfferDocumentDraft`, replace nothing and add:

```ts
  // The "This price includes" list beside the price — the SELLING view of the
  // schedule. Its own list because the relationship is one-to-many. Kept honest
  // against inclusionSchedule by an on-demand AI check, not by a stored link.
  readonly inclusionHighlights: readonly string[];
```

Seed `INITIAL_OFFER_DRAFT.inclusionHighlights` from the template's existing summary values (the 14 that exist today), and drop `summary` from `STANDARD_INCLUSION_ENTRIES` — the row type keeps `summary` only as the seed source for that list.

Delete `getSummaryInclusions`, `inclusionSummaryState`, `staleSummaryIndexes`, `inclusionCopyRequests`, `pendingInclusionCopyCount`, `applyInclusionCopyPatches` and their types. They all encoded the one-to-one assumption.

- [ ] **Step 4: Schema and migration**

Bump `CURRENT_WORKSPACE_SCHEMA_VERSION` to `6`. Add `inclusionHighlights: z.array(z.string()).default([])` to `draftSchema`, and drop `summary`/`summaryFromSpec` from `inclusionEntrySchema`.

```ts
// v5 → v6: the selling list moves off the schedule rows and becomes its own
// list. v5 stored it as a `summary` on each entry, which asserted one selling
// line per contract row — but "All structural works — slab, frame, roof" covers
// six rows on a real offer. Summaries are lifted out IN SCHEDULE ORDER, which
// is the order they already printed in, so page 4 is byte-identical after the
// migration. Nothing is lost: a summary was always just a line of page-4 text.
function migrateV5ToV6(state: Record<string, unknown>): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const schedule = Array.isArray(draft.inclusionSchedule) ? draft.inclusionSchedule : [];
  const highlights: string[] = [];
  const stripped = schedule.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const { summary, summaryFromSpec: _dropped, ...rest } = raw as Record<string, unknown>;
    if (typeof summary === "string" && summary.trim().length > 0) {
      highlights.push(summary);
    }
    return rest;
  });
  return {
    ...state,
    schemaVersion: 6,
    draft: {
      ...draft,
      inclusionHighlights: Array.isArray(draft.inclusionHighlights)
        ? draft.inclusionHighlights
        : highlights,
      inclusionSchedule: stripped,
    },
  };
}
```

Chain after `migrateV4ToV5`. Thread `inclusionHighlights` through `serializeWorkspace`.

- [ ] **Step 5: Point page 4 at the new list**

In `lib/offer/workspace-print-template.ts`, `summaryInclusions` becomes
`draft.inclusionHighlights.map((h) => h.trim()).filter(Boolean)`. Remove the
`getSummaryInclusions` import. The three renderers are unchanged — they already
read `data.summaryInclusions`.

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Fix every construction site the typecheck lists.

```bash
git commit -m "refactor(offers): selling highlights become their own list"
```

---

## Task 2: AI drafts the highlights from the schedule

**Files:**
- Rewrite: `lib/offer/inclusion-copy-ai.ts`
- Modify: `lib/data/offer-inclusion-copy.ts`

**Interfaces:**
- Produces: `draftInclusionHighlights(schedule): Promise<{ ok: true; highlights: string[] } | { ok: false; message: string }>` and a server action wrapping it.

- [ ] **Step 1: Replace the per-row generator**

The schedule goes in whole; ~12 selling lines come out. Grouping is the point — this is the call that turns six structural rows into one line.

```ts
const SYSTEM_PROMPT = `You write the "This price includes" list for an Australian fixed-price residential building offer.

You are given the full contractual Inclusions Schedule. Write 10-14 short selling lines that summarise it for the page beside the price.

<hard_rules>
- Every line must be supported by the schedule. NEVER promise anything the schedule does not contain — an invented inclusion becomes a contractual obligation.
- GROUP related rows. "All structural works — slab, frame, roof" covering six rows is correct and wanted; one line per row is not.
- Lead with the concrete thing the schedule names: material, size, brand, quantity. Preserve stated values EXACTLY (40mm stays 40mm).
- Maximum 8 words per line. Australian English. No trailing full stop.
- Cover the whole schedule proportionally. Do not leave a major trade area unmentioned.
- No marketing adjectives the schedule does not itself use.
</hard_rules>`;
```

Schema: `z.object({ highlights: z.array(z.string()) })`. Trim, drop blanks, cap at 20.

- [ ] **Step 2: Server action**

`draftHighlightsForOffer({ leadId, schedule })` — same auth preamble as
`draftInclusionCopy` (`auth()` → `getUserByClerkIdCached` → `assertCanAccessLead(user, leadId)`), returning the drafted list for the estimator to accept or edit. Never writes.

- [ ] **Step 3: Verify against the live model, not just types**

Run a scratch script against the real gateway with offer 58's 63-row schedule. Confirm by reading the output: values preserved verbatim, related rows grouped, no inclusion present that the schedule does not support. Record the actual output in the commit message.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(offers): draft the selling highlights from the schedule"
```

---

## Task 3: The consistency check

**Files:**
- Modify: `lib/offer/inclusion-copy-ai.ts`, `lib/data/offer-inclusion-copy.ts`, `lib/offer/offer-readiness.ts`
- Create: `components/offers/new-workflow/offer-inclusion-check-panel.tsx`
- Test: `tests/offer/inclusion-schedule.test.ts`

**Interfaces:**
- Produces:

```ts
export type InclusionFinding = {
  readonly kind: "unsupported" | "contradicted" | "unmentioned";
  // Index into inclusionHighlights, or null for "unmentioned".
  readonly highlightIndex: number | null;
  // 1-based schedule rows that bear on this finding.
  readonly scheduleRows: readonly number[];
  readonly detail: string;
};
```

`unsupported` = a highlight nothing in the schedule backs. `contradicted` = a highlight and a schedule row disagree ("Lux kitchen" vs "Minimalistic kitchen"). `unmentioned` = a significant schedule area no highlight covers.

- [ ] **Step 1: Write the failing readiness test**

```ts
test("an unresolved mismatch warns before send but never blocks it", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true, needsOverrideReason: false, expiryState: "valid",
    inclusionFindingCount: 2,
  });
  const finding = blockers.find((b) => b.id === "inclusion-consistency");

  assert.ok(finding, "an unresolved mismatch must surface before send");
  assert.equal(finding.severity, "warn", "a model false positive must not stop a live deal");
  assert.equal(finding.stepId, "offer-step-offer-document");
});

test("no findings, no blocker", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true, needsOverrideReason: false, expiryState: "valid",
    inclusionFindingCount: 0,
  });
  assert.equal(blockers.some((b) => b.id === "inclusion-consistency"), false);
});
```

- [ ] **Step 2: Add the check prompt**

Both lists go in; findings come out. The model must cite schedule rows, so a
finding can be inspected rather than trusted.

```
<hard_rules>
- Judge ONLY whether the schedule supports each selling line. Do not rewrite either list.
- Cite the schedule row numbers behind every finding. A finding with no rows cited is not a finding.
- A selling line that GROUPS several rows is correct, not a mismatch.
- Report a contradiction only where a stated value or material genuinely differs (40mm vs 60mm, minimalistic vs custom shaker). Different wording for the same thing is not a contradiction.
- Prefer silence to a weak finding. A false alarm on a live deal costs more than a missed nuance.
</hard_rules>
```

- [ ] **Step 3: Readiness wiring**

Extend `OfferSendReadinessInput` with `inclusionFindingCount?: number` and emit
a `warn` blocker at `stepId: "offer-step-offer-document"` when it is above zero.
Findings are held in workspace state, not persisted — a check result is a point-in-time
judgement and a stale one on a reloaded offer is worse than none.

- [ ] **Step 4: The panel**

`offer-inclusion-check-panel.tsx` lists findings under the highlights: the
finding text, the schedule rows it cites (clickable, scrolling to the row), and
per-finding **Dismiss**. `unsupported` findings additionally offer **Add to
schedule** (Task 4).

- [ ] **Step 5: Run everything and commit**

```bash
git commit -m "feat(offers): check the selling list against the contractual schedule"
```

---

## Task 4: Draft a schedule row for an unsupported highlight, on approval

**Files:**
- Modify: `lib/offer/inclusion-copy-ai.ts`, `lib/data/offer-inclusion-copy.ts`, `components/offers/new-workflow/offer-inclusion-check-panel.tsx`

**This is the only place the model drafts contract text.** It is reachable only from
an `unsupported` finding, it produces a *candidate*, and nothing enters the
schedule until the estimator presses Add. The approval step is not skippable and
must not be collapsed into the check.

- [ ] **Step 1: Draft one row**

`draftScheduleRowForHighlight({ leadId, highlight, schedule })` returns
`{ spec, category }`. Prompt rules: write in the voice and grain of the existing
rows; state only what the highlight claims; if the highlight is too vague to
support a contractual sentence, return empty and say so rather than inventing
detail.

- [ ] **Step 2: The approval UI**

The candidate renders in an editable field with the highlight it came from
above it, and two actions: **Add to schedule** and **Cancel**. Label it plainly
as drafted text awaiting approval. On Add, append `{ spec, category }` to the
schedule and clear the finding.

- [ ] **Step 3: Test that nothing reaches the schedule without approval**

```ts
test("drafting a row returns a candidate and never mutates the schedule", async () => {
  // The action returns { spec, category }; the caller appends. Assert the
  // action has no write path — it takes the schedule by value and returns a row.
});
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(offers): draft a schedule row for an unsupported claim, on approval"
```

---

## Task 5: Canvas rework and ADR

**Files:**
- Modify: `components/offers/new-workflow/offer-document-canvas.tsx`, `tests/offer/offer-document-canvas.test.ts`
- Modify: `docs/adr/0006-per-offer-inclusion-schedule.md`

- [ ] **Step 1: Highlights list replaces the featured block**

"This price includes" becomes an `EditableBulletList` over `inclusionHighlights`
with **Draft from schedule** and **Check against schedule** actions. The star
toggle and the per-row featured state disappear from the schedule entirely —
there is nothing to star any more.

- [ ] **Step 2: Amend ADR 0006 a third time**

Record: the one-to-one assumption was wrong and why (the six-row example from
offer 58); two lists is correct, drift is prevented by checking not merging;
the model may draft a schedule row only behind explicit approval; findings are
`warn`, never `block`.

- [ ] **Step 3: Verify in the running app, then commit**

`pnpm dev`, offer 58: draft highlights, edit one to something the schedule does
not support, run the check, confirm it is caught, approve a drafted row, confirm
the send warning clears.

---

## Self-Review Notes

**Against the requirement:**

- ✅ Two lists, one-to-many — Task 1
- ✅ Adding a selling line is matched against the schedule — Task 3
- ✅ Existing row → the check confirms support; no row → drafted row on approval — Task 3/4
- ✅ On-demand check plus a send warning — Task 3

**Risks, stated plainly:**

- **This is the third shape for this data in one branch** (v4 entries, v5 +category, v6 highlights split). Every shape shipped a migration. The branch is now ten commits of design churn that `/code-review ultra` will read as an end state. Landing what exists first, then doing this as its own branch, is a legitimate alternative and probably the safer one.
- **The check is a model judgement on contract text.** `warn` not `block` is deliberate, but a missed contradiction is a real hazard and this does not replace an estimator reading the document.
- **Task 4 crosses the line held all day** — the model writing text Royal is bound by. Approval must stay explicit; if that gate is ever weakened, this becomes the most dangerous code in the offer workspace.
- **Unchanged and still open:** `job.buildScope` prints on the tender but freezes at send; the welcome letter remains hard-coded; offer 58 still carries 19 rows pulled before the Pull button was removed.
