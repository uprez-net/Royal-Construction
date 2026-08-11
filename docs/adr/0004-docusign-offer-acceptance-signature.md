# 4. DocuSign e-signature for the Offer document (acceptance gate)

Date: 2026-07-28

## Status

Accepted. Extends ADR 0001 (DocuSign e-signature) and ADR 0002 (offer workspace
persistence). **Revises** ADR 0001's "Negotiation channel (v1): the Offer document
is emailed with a tracked link; the customer replies by email … not signed."

## Context

ADR 0001 deliberately kept the **Offer document** as an *unsigned* negotiation
artifact — emailed with a tracked link, the customer replying by email while staff
log changes into a new revision — and reserved DocuSign for the **Tender** and
**Contract**.

Two facts pushed us to revisit that:

1. **The document already asks to be signed.** `buildProposalHtml`
   (`lib/offer/offer-proposal-html.ts`) is not a one-pager; it renders a branded
   multi-page proposal ending in an **acceptance paragraph** — *"I/We, {owners},
   accept this proposal and agree to proceed to a Master Builders Association fixed
   price home building contract"* — and a **wet-sign block per signer** built from
   the same `collectOfferSigners(job.owners)` helper the Tender uses. Acceptance
   was already the document's purpose; only the *capture* was off-system (wet-sign
   / emailed reply).

2. **The business wants an auditable acceptance.** Capturing the customer's
   acceptance as a real e-signature — rather than a wet-sign PDF or an emailed
   "yes" — gives an audit trail and a clear gate before the legal Tender is
   generated, reusing the DocuSign machinery already built for Tender/Contract.

The `CONTEXT.md` glossary described the Offer document as a *"summary one-pager …
no numbered inclusion table … no payment schedule"*, which the shipped renderer
contradicts (it carries a standard inclusions schedule, a payment schedule, and
the acceptance/signature pages). That entry is corrected alongside this ADR.

## Decision

Add a **customer-only DocuSign signing path for the Offer document**, as an
**acceptance gate** before the Tender. Reuse the Tender pattern (runtime-generated
PDF + anchor AutoPlace), not the Contract's server-template machinery.

- **Signers — customer only.** Every customer-side signatory (each individual
  owner; each company director) via `collectOfferSigners`, all at **routingOrder
  1**. **No builder recipient** — the builder's binding signature stays on the
  Tender/Contract. On the signed copy the builder block becomes a non-signature
  *"Prepared by {preparedBy}, Royal Constructions Pty Ltd"* credit.
- **Document — the existing Offer document.** `buildProposalHtml` gains a
  *"for signature"* mode that emits DocuSign anchors (`\sigOwner{k}\` /
  `\dateOwner{k}\`) in place of the wet-sign lines for the customer blocks. The
  offer `esc()` gains **backslash-stripping** in that mode to prevent
  anchor-token smuggling, mirroring `lib/offer/offer-tender-html.ts`. The email
  negotiation copy is unchanged (wet-sign lines).
- **Transport — coexists with email.** The Graph email negotiation send
  (repeatable, tracked link, open/reply telemetry) is retained for the
  back-and-forth. **"Send for signature"** is a distinct action, used once scope
  and price are settled; it **freezes the offer-document snapshot** being signed.
  Signing is *not* forced on every negotiation round.
- **Lifecycle — new states, estimator still gates the Tender.** Add
  `OFFER_SENT` (out for signature), `OFFER_SIGNED` (all customers signed), and
  `OFFER_DECLINED`. Envelope completion lands in **OFFER_SIGNED** and archives the
  executed PDF; the estimator then uses the existing **Mark agreed** action
  (→ `AGREED`) to freeze the internal snapshot and generate the Tender. Signing
  does **not** auto-generate the Tender — the "estimator reviews/edits Tender
  before send" invariant is preserved.
- **Persistence — extend, don't duplicate.** `EnvelopeDocType` gains `OFFER`.
  `Envelope` gains a nullable `offerId` (parallel to `tenderId`/`contractId`).
  `Offer` gains `executedPdfUrl` + an `envelopes[]` relation. Per-signer rows use
  the existing `EnvelopeSignature` (recipientRole `CUSTOMER`, capacity/entity
  metadata), exactly as Tender/Contract. No new parent table.
- **Webhook — a third branch.** The Connect webhook
  (`app/api/docusign/connect/route.ts`) gains an `OFFER` branch: per-signer sync,
  forward-only `OFFER_SENT → OFFER_SIGNED` (decline → `OFFER_DECLINED`), and
  executed-PDF archival to `offer-signed/offer-{docusignId}.pdf`.
- **Negotiation visibility.** Step 6 surfaces a per-revision **activity timeline**
  from existing telemetry (`OfferDocumentSend` sent/opened/replied +
  `OfferStatusEvent`) plus a manual **"change request" note**. Full email-body
  ingestion is deferred.

## Consequences

- **Reverses ADR 0001's "offer emailed, not signed" v1 stance.** The offer
  acceptance is now an auditable e-signature; email negotiation is retained
  alongside it, so the negotiation loop is unchanged.
- **Three customer signature events now exist before Project** (offer acceptance,
  Tender, Contract). Accepted deliberately: the offer acceptance is a lightweight
  *authority to proceed*; the Tender is the legal fixed-price document and the
  Contract is the building contract. The acceptance is customer-only, so it adds
  no builder signing burden.
- **Migration:** new enum values (`OFFER`; `OFFER_SENT`/`OFFER_SIGNED`/
  `OFFER_DECLINED`), `Envelope.offerId`, `Offer.executedPdfUrl`. Additive —
  existing Tender/Contract rows are untouched.
- **Modest incremental surface.** Reuses `collectOfferSigners`,
  `EnvelopeSignature`, the Connect webhook, void/recall (`voidEnvelope` via
  `transition('*_draft')`-style recall), the `SigningTracker` /
  `EnvelopeSendConfirm` UI primitives, and the `pollOfferSigningStatus` loop
  (gate extended to `offer_sent`). New code: `lib/docusign/offer-envelope.ts`, a
  `sendOfferForSignature` server action mirroring `offer-tender-sign.ts`'s
  atomic-claim discipline, an `OFFER` key in `lib/offer/signing-status.ts`, and
  the "for signature" mode on `buildProposalHtml`.
- **Security:** the offer `esc()` must strip backslashes in signature mode; a
  regression there would let an owner name inject or displace an anchor tab.
  Reuse/port the Tender's proven `esc()`/`anchor()` discipline.
- **Reversible at cost:** unwinding removes UI, a webhook branch, and a server
  action, but the enum values and columns would linger until a follow-up
  migration.
