# 5. Offer content stays editable after send; the price freezes

Date: 2026-07-30

## Status

Accepted. Refines ADR 0002 (offer workspace persistence) and the `CONTEXT.md`
entries "Offer workspace entry" and "Offer editing persistence". Resolves
issue #117 ("Offer content should be editable after generation").

## Context

The Offer-build steps (Job setup, Cost schedule, Pricing, Scope, Offer document)
all locked the instant the offer left `pending`:

```ts
// offer-workspace-screen.tsx (before)
const isOfferLocked = status !== "pending";
```

Once an offer was generated and **sent**, the estimator could no longer touch the
customer-facing proposal to negotiate — the only path to any change was forking a
whole **New revision**. Two things made this wrong:

1. **It contradicted the canonical glossary.** `CONTEXT.md`'s editable window ran
   through **pending** and **sent** negotiation (only `agreed` / `tender_signed` /
   `rejected` / `superseded` were called out as read-only), while the lock followed
   the older `docs/offer/OFFER-DESIGN.md` line ("read-only when sent"). This ADR
   refines that glossary to the precise per-area rule in the Decision below —
   customer-facing content editable through `sent`, internal price inputs frozen
   at send.

2. **It was internally inconsistent.** The workspace autosave already persists in
   `sent` (`new-offer-workspace.tsx`), and the server save (`saveOfferWorkspace`)
   has **no status guard** — it only enforces optimistic concurrency. So the
   plumbing already supported editing a sent offer; only the UI forbade it.

The competing concern was **pricing integrity**: if editing reopens after send,
can the quoted price drift, or a binding document desync? Investigation showed each
binding document captures its **own** snapshot at its **own** moment, so an edit
made in `sent` can't retroactively change one already produced:

- the **Contract** is built from `agreedSnapshot`, frozen on the first transition
  into `agreed`;
- the **DocuSign acceptance PDF** is captured when the offer goes out for signature
  (`offer_sent`, which stays fully locked);
- the **emailed offer PDF** is a point-in-time copy taken at each send — so editing
  after a send only changes what the *next* send carries, never the copy already in
  the client's inbox.

The price itself is built only from the internal cost `lines` + areas + settings
(`calculateDirectTotal`); Scope items (allowances/exclusions) render on the document
but never enter the price.

## Decision

Freeze the offer **progressively, by area**, instead of all at once. A single pure
helper (`lib/offer/offer-editability.ts`, `isOfferBuildStepEditable(step, status)`)
is the source of truth; each `OfferStepSection`'s `locked` prop reads from it.

- **Customer-facing content stays editable through `sent`.** The **Offer document**
  step (headline, intro, inclusion bullets, terms summary) and the **Scope** step
  (allowances/exclusions shown on the document) accept edits while `pending` **or**
  `sent`, auto-saving over the offer. This is the negotiation window; each
  subsequent send emails the updated document.
- **Internal price inputs freeze at send.** **Job setup**, **Cost schedule** and
  **Pricing** accept edits only while `pending`. Once the offer is issued the
  quoted price cannot change in place — a price/cost/area change is a **New
  revision**, preserving a clean audit trail per issued price.
- **The Offer-build steps freeze past `sent`.** `offer_sent` (envelope out —
  snapshot frozen for signing), `offer_signed`, `agreed` and every later/terminal
  state lock all **five Offer-build steps**. (The separate Tender-phase step — the
  payment schedule — stays editable through `tender_draft` and freezes at
  `tender_sent`; that is unchanged by this ADR.)
- **The lock banner is status-aware.** In `sent` it explains the *partial* lock
  (document + scope still editable; price frozen → new revision); otherwise it
  keeps the full-lock copy.

No server, persistence, or renderer change — the freeze is a client-side lock
layered over machinery that already permits `sent` edits. The price freeze is
therefore **workflow-enforced, not a hard server invariant**: `saveOfferWorkspace`
has no status guard, so the guarantee rests on the UI lock plus the existing
optimistic-concurrency + reconcile (which rejects a stale tab's out-of-date save).
For a trusted internal estimator tool that is sufficient. If a hard guarantee is
later required, add a status-aware guard to `saveOfferWorkspace` that rejects
changes to price-relevant fields (cost lines, floor areas, pricing settings, the
manual price override) once the offer has left `pending`.

## Consequences

- **Resolves #117** and aligns the code with the canonical `CONTEXT.md` model;
  the stale `OFFER-DESIGN.md` "read-only when sent" line is superseded.
- **Pricing model stays intact.** Through the workspace the quoted price is
  immutable after send (see the workflow-enforcement note above); every binding
  document is still generated from a snapshot frozen at its own gate. Unlocking
  Scope is safe because scope items never feed the price.
- **Known edge, accepted:** the state machine allows `offer_signed → sent` and
  `offer_declined → sent`. An estimator who backs out of an acceptance into `sent`
  can then edit the *document/scope* (not the price). This is low-risk — the
  acceptance is a lightweight "authority to proceed", the binding price is the
  Tender/Contract, and the price cannot change without a new revision.
- **Testable invariant.** `tests/offer/offer-editability.test.ts` asserts the rule
  across every `OfferWorkspaceStatus`, so a future status can't silently default to
  editable or locked.
- **Reversible at near-zero cost:** the helper and the per-step wiring can revert
  to a single `isOfferLocked` boolean; nothing else depends on the split.
