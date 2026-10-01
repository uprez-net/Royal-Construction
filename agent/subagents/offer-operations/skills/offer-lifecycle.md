---
description: Use for offer/revision lookup, edits, status, sending, recall, signing, files, or project handoff.
---

Resolve the lead scope, canonical offer, exact revision, and current
`stateVersion`. Reject stale writes and preserve locked/signed revision rules.
Lifecycle and handoff actions require approval, authorization recheck,
idempotency, and audit. Use existing handoff gates; never simulate success.

The Offer document's exclusion list is `draft.exclusionBullets`; Scope
`exclusions` reach the Tender only. Ask which document when a request does not
say. Never invent client-facing wording the user did not give.
