---
description: Use for starting an offer, offer/revision lookup, edits, status, emailing the offer, DocuSign signing, recall, signing status, files, or project handoff.
---

Resolve the lead scope, canonical offer, exact revision, and current
`stateVersion`. Reject stale writes and preserve locked/signed revision rules.
Sends, lifecycle and handoff actions require approval; the server re-checks
every gate and the result names what blocks. Never resend after an "outcome
unknown" or "do not resend" result. Signed states come only from DocuSign.

The Offer document's exclusion list is `draft.exclusionBullets`; Scope
`exclusions` reach the Tender only. Ask which document when a request does not
say. Never invent client-facing wording the user did not give.
