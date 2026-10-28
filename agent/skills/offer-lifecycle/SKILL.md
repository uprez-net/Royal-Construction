---
description: Use for offer status, workspace content, revisions, version conflicts, send or recall, signing, lifecycle transitions, files, and project handoff.
---

# Offer lifecycle

## Canonical sources

Use `lib/domain/offers` (start, status, revisions, recall, workspace save),
`lib/offer/sends` (the proposal email, the three DocuSign sends and the project
handoff, shared with the app), `lib/offer`, offer validators and
`OfferStatusEvent`. Preserve the current lead-scope guard.

## Lookup order and contracts

Resolve the lead, canonical active offer, exact revision, and current
`stateVersion`. Return revision-aware typed summaries and comparisons. Only
allow explicitly mapped fields and lifecycle operations.

## Preconditions and ambiguity

Never mutate sent, agreed, locked, or signed content in place when the domain
requires a revision. A stale version requires refresh and review, not an
automatic retry. Resolve ambiguous offer/revision references explicitly.

## Approval, audit, and recovery

Send, recall, status transition, acceptance/tender/contract work, and handoff
require approval, authorization recheck, durable idempotency, and audit. Handoff
must pass the existing signature/document/access gates.

## Examples

- A stale edit returns a comparison and asks the user to review current data.
- A signed offer edit proposes an explicit revision rather than unlocking it.
- A project is created only through `create_project_from_offer` after all gates pass.
