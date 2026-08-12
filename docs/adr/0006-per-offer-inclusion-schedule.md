# 6. The inclusions schedule is per-offer editable copy, not a code constant

Date: 2026-08-12

## Status

Accepted, then **superseded in part on the same day** — see "Amendment: one list,
edited on the document" at the end. The core decision (the schedule is per-offer
editable copy, persisted in the snapshot, printed as a plain numbered list)
stands. The decision to keep `inclusionBullets` as a *second* hand-edited list,
and to edit both through a form, did not survive first contact with a user.

Extends ADR 0002 (offer workspace persistence — snapshot schema now v4) and
applies ADR 0005's editable-through-`sent` rule to the schedule.

## Context

Everything a client read as "what is included / excluded" came from six places
across three workflow steps and two hard-coded constants:

| What printed | Source | Editable in the Offer phase? |
| --- | --- | --- |
| Offer "This price includes" | `draft.inclusionBullets` | yes — Step 5 |
| Offer "Full inclusions schedule" (3 pages) | `STANDARD_INCLUSIONS_SCHEDULE` | **no — code only** |
| Tender "Scope of Works — Inclusions Schedule" | `STANDARD_INCLUSIONS_SCHEDULE` | **no — code only** |
| Offer/tender "Exclusions" | `draft.exclusionBullets` ∪ Scope items | **no — bullets had no editor** |
| Allowances table | `allowances[]` Scope items | yes — Step 4 |
| Tender scope line | `job.buildScope` | Step 1 only — freezes at send |

Two consequences.

**Nobody at Royal could change the schedule.** Every offer carried the same 44
rows ("Double storey structural timber frame", "Westinghouse package: 90cm
cooktop") regardless of the actual job, and altering a word required a deploy.

**No on-screen surface predicted the client's document.** Three surfaces each
combined the lists differently:

| Surface | Inclusions shown | Exclusions shown |
| --- | --- | --- |
| Offer PDF / tender PDF | bullets; schedule from the constant | bullets **∪** Scope items |
| Offer on-screen preview | cost-line wording | Scope items **only** |
| Tender on-screen | `inclusionBullets` | bullets **if any, else** Scope items |

So an estimator adding an exclusion bullet saw nothing change in the offer
preview, saw Scope items *disappear* from the tender view, and got both on the
PDF. `workspace-print-template.ts` also computed an `offerTenderLineItems` field
that no renderer ever read.

This drift was already known and under-treated: `workspace-proposal-content.ts`
documents that the bullets and the schedule had previously disagreed on stone
thickness and floor finish. The fix at the time — `OFFER_SPEC_FACTS`, shared
constants — removed one symptom without making the content editable.

## Decision

**The schedule is per-offer editable copy.** `OfferDocumentDraft` gains
`inclusionSchedule: readonly string[]` — one specification sentence per entry —
seeded from `STANDARD_INCLUSION_SPECIFICATIONS`, which is now derived from the
old constant and used **only as seed data**. It persists in the workspace
snapshot, so a sent offer freezes against what it actually said. Schema v2 → v3
seeds pre-existing offers with the template list, so re-rendering a historical
revision reproduces the document that client received. An explicitly empty array
is left alone — from v3 on, "no rows" is a choice the estimator can make.

**The Offer document step owns all customer-facing inclusion/exclusion copy.**
Retitled "Offer & tender content", it now carries the schedule editor, the
previously missing exclusion-bullets editor, and a read-only view of the
Scope-sourced exclusions that also print. Per ADR 0005 this step is editable
through `sent`, so the whole negotiation window is covered.

**`mergeCostScheduleIntoSchedule` is the explicit link from price to prose.** A
"Pull wording from cost schedule" action appends the offer/tender wording of
every included, priced cost line not already listed. It never removes or
rewrites an estimator's edits, and it is estimator-triggered rather than
automatic — Step 2 freezes at send, so wording must be copied into the draft to
stay editable during negotiation.

**One resolver, every surface.** `getVisibleExclusions` (the PDF's union rule —
correct because it is what the client receives) is exported and used by the offer
preview, the tender view and both PDFs. The dead `offerTenderLineItems` field is
gone.

**The schedule prints as a plain numbered list.** The `Category` column is
dropped from both the offer and the tender; only the specification wording
renders. Pagination budgets by **estimated wrapped height**, not row count,
shared across all three renderers via `chunkInclusionSchedule`.

**AI generation was considered and deferred.** The schedule is the specification
inside a fixed-price MBA contract, so a hallucinated line becomes something Royal
is legally obliged to build. `offer-prefill-ai.ts` already forbids the model from
inventing construction details for that reason. Seeding is deterministic.

## Consequences

- **Royal can tailor the schedule per job** without a deploy, and the preview,
  the tender view and both PDFs now show the same content.
- **`highlight` emphasis is lost.** Three rows (full-facade render, luxury
  kitchen, ducted AC) rendered with a gold background; a flat `string[]` cannot
  carry that flag. Their text survives, the visual cue does not. Accepted as the
  cost of an editor an estimator can actually use.
- **A fixed rows-per-page count would now be unsafe.** With editable free text, a
  long specification overflows the page and desyncs the "Page N of M" footer —
  the defect PR #124 fixed for signature blocks. Height-based chunking is shared
  by all three renderers so they cannot drift, as the signature budgets once did.
  Verified against puppeteer-rendered PDFs: declared page divs match actual PDF
  pages for both the seeded 42-spec schedule and a 30-entry stress schedule of
  three-line specifications.
- **`OFFER_SPEC_FACTS` no longer structurally prevents drift.** Once an estimator
  edits either list they can disagree. This is now a human decision on a document
  a human reviews before sending, rather than a code invariant.
- **Bug found and fixed in passing:** `workspaceStateV1Schema` pinned
  `schemaVersion: z.literal(2)` while `serializeWorkspace` wrote
  `CURRENT_WORKSPACE_SCHEMA_VERSION`. Bumping the constant made every parse
  throw, and `resolveOfferContractValue` swallows parse errors in a `catch`, so
  the only visible symptom was contract values silently rendering as "—". The
  literal is now derived from the constant, with a test pinning them together.
- **Still open — `job.buildScope`.** It prints on the tender but is edited in Job
  setup, which freezes at send (ADR 0005). One line of tender scope text is
  therefore still uneditable during negotiation. Closing it means either moving
  `buildScope` onto the draft or carving it out of the Job-setup freeze; both
  touch the pricing-freeze boundary ADR 0005 deliberately drew, so it is left to
  its own decision.
- **Admin-level defaults are unchanged.** If Royal later wants to edit the
  boilerplate itself, that is an `inclusionsSchedule` field on
  `AdminOfferContent` plus a tab in `components/offers/admin/`, following the
  existing `offerContent` pattern.
- **Also unaddressed:** the welcome letter (`buildWelcomeParagraphs`) remains
  hard-coded — the same class of problem, worth a follow-up.

---

## Amendment: one list, edited on the document

Date: 2026-08-12

### What went wrong

The decision above made the schedule editable but left `inclusionBullets` — the
"This price includes" list on the Investment Summary page — as a second,
separately hand-edited list. Step 5 then asked an estimator to fill five fields
totalling roughly 65 lines, the largest being a 42-line monospace textarea
inside a form.

Two problems, and the second is the serious one.

**Nobody maintains that.** It reads as data entry, not as a document. The
likely outcome is that it gets filled once and never revisited, and the
estimator stops trusting that the document reflects reality.

**It reinstated the exact drift `OFFER_SPEC_FACTS` exists to prevent.** On a
real offer, page 4 promised `60mm stone benchtops throughout` and `Timber-look
herringbone flooring` while pages 5–7 promised `40mm engineered stone` and
`600 x 1200 porcelain tiles` — different materials on different cost bases, in
the same fixed-price contract. The `60mm`/`herringbone` wording had been removed
from the codebase in `c2f0737` ("reconcile proposal specs"); the offer's saved
bullets still carried it. Shared constants cannot help once both lists are free
text a human edits separately.

### Decision

**One list.** `draft.inclusionSchedule` is now `OfferInclusionEntry[]`, where an
entry is `{ spec, summary? }`. `spec` is the contractual sentence printed in the
Inclusions Schedule. `summary` is the optional short form printed beside the
price. `draft.inclusionBullets` is deleted.

**Page 4 is derived, not authored.** `getSummaryInclusions()` collects the
summaries; the Investment Summary list has no editor. This is the substance of
the fix — the contradiction is no longer representable, rather than merely
discouraged.

**The document is the editor.** `offer-document-canvas.tsx` renders the offer as
a document with every block editable in place, replacing both the copy form
(`offer-workspace-document.tsx`) and the narrow sidebar preview
(`offer-workspace-preview.tsx`), which are deleted. `PricingSummary` is
extracted to `offer-workspace-pricing-summary.tsx` — it is still wanted on every
step; the document preview it shared a file with was not.

**Real form controls, never `contentEditable`.** This text is printed verbatim
into an MBA fixed-price contract. `contentEditable` accepts pasted HTML, so a
paste from Word could carry markup into a legal document. Textareas styled as
document copy give the same in-place feel with none of that.

**The canvas is not the print template.**
`offer-workspace-print-template.tsx` remains the pixel-accurate print/PDF
surface; the canvas mirrors its structure at screen width. One component serving
both is how a CSS tweak silently breaks the PDF.

### Consequences

- **Two orphan bullets became real inclusions.** "All PC items per inclusions
  schedule" and "Council certifier and approval fees" were sold on page 4 with
  no schedule row, so collapsing the lists would have dropped them. They now
  have specs of their own. All 14 page-4 items survive.
- **v3 → v4 is lossy, deliberately.** The schedule wins and the stale bullets
  are dropped rather than migrated onto summaries: when two claims conflict
  there is no reliable way to tell which the estimator meant, and carrying
  known-contradictory text into a contract is worse than losing it. An untouched
  seeded spec regains its summary, so an offer that never diverged keeps a
  populated page 4; an offer with a hand-tuned page 4 loses that tuning. Flagged
  to and accepted by the user before implementation.
- **Page 4 can no longer carry a line with no schedule counterpart.** If Royal
  wants one, they add a schedule entry and give it a summary. That constraint is
  the feature.
- **v3 never shipped** (branch unmerged), but local snapshots existed from
  testing, so v4 is a real migration rather than an amendment to v3.
- **`OFFER_SPEC_FACTS` is now belt-and-braces.** It still keeps the seed's spec
  and summary phrasings aligned, but it is no longer the only thing standing
  between the two surfaces — there is only one surface.
- **Unchanged from the original decision:** `job.buildScope` prints on the
  tender but freezes at send; the welcome letter remains hard-coded.

---

## Amendment 2: the Category column comes back

Date: 2026-08-12

Dropping the Category column went too far. It is restored on both printed
documents exactly as it was: `Category | Specification` with its heading row on
the offer, `# | Category | Specification | Status` on the tender.

- **Entries carry `category` again.** `OfferInclusionEntry` is now
  `{ spec, summary?, category? }`, seeded from the template's `category`, with a
  v4 → v5 migration that re-attaches it by matching the spec text against the
  seed. That match is the only place the mapping exists.
- **Uncategorised entries print `Miscellaneous`.** An entry pulled from the cost
  schedule or typed by an estimator has no template match. An empty cell on a
  fixed-price contract reads as an omission, so it gets a real word.
- **`group` stays unused.** Investigation found `row.group` was **never rendered
  anywhere** in the project's history — the six trade groups only ever affected
  the order rows were authored in. Trade headings were considered and declined:
  they would be new structure on a client-facing contract, not a restoration.
- **Pagination was recalibrated, and this is not cosmetic.** The Category column
  takes 45mm of the 165mm content width, so a spec wraps in ~68 characters, not
  95, and a table row costs its tallest cell plus padding where a list item cost
  neither. The un-recalibrated budget overflowed the seeded schedule by two
  physical sheets while the footer still claimed 7 pages — the footer-desync
  defect PR #124 fixed for signature blocks. `CHARS_PER_LINE_INCLUSION` is 68,
  rows add `INCLUSION_ROW_CHROME_LINES`, and the page budget is 40 line units.
  Verified against puppeteer-rendered PDFs on a seeded and a long-spec stress
  schedule; declared page divs equal actual PDF pages on all four documents.
- **Known gap:** the canvas has no category editor, so an entry the estimator
  adds or pulls will print `Miscellaneous` with no way to change it. Adding a
  category field per row is the obvious follow-up, deliberately not taken here
  because the whole point of the canvas rework was to reduce what an estimator
  has to fill in.
