# 6. The inclusions schedule is per-offer editable copy, not a code constant

Date: 2026-08-12

## Status

Accepted. Extends ADR 0002 (offer workspace persistence — snapshot schema now
v3) and applies ADR 0005's editable-through-`sent` rule to the schedule.

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
