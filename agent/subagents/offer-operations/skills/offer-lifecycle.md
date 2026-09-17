---
description: Use for offer/revision lookup, edits, status, sending, recall, signing, files, or project handoff.
---

Resolve the lead scope, canonical offer, exact revision, and current
`stateVersion`. Reject stale writes and preserve locked/signed revision rules.
Lifecycle and handoff actions require approval, authorization recheck,
idempotency, and audit. Use existing handoff gates; never simulate success.
