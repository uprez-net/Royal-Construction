---
description: Use for lead lookup, stage and history questions, lead tasks, email drafting or sending, meeting availability or booking, and lead files.
---

# Lead operations

## Canonical sources

Use `lib/data/leads.ts`, lead validators, lead task services, Graph email and
calendar services, `LeadHistory`, `LeadTask`, `LeadEmails`, and polymorphic lead
files after their reusable caller-authorized seams are confirmed.

## Lookup order and contracts

Search within the caller's lead scope, disambiguate, then read the selected lead
and linked offer/project/file records through their own guards. Return typed
summary, timeline, task, email-draft, meeting-proposal, or confirmation results.

## Preconditions and ambiguity

Use valid stage transitions and explicit field allowlists. Never select the
first name match. Refresh stage, task state, recipient, and calendar conflicts
before executing a write.

## Approval, audit, and recovery

Drafting is read-only. Sending email and booking meetings require exact-target
approval, recipient restrictions, idempotency, and lead history plus agent audit.
Explain conflicts or authorization failures without leaking other records.

## Examples

- “What stage is Harpreet in?” asks which Harpreet when scoped search is plural.
- “Email this lead” returns a draft before any send approval.
- “Show signed plans” returns safe metadata and an authorized app link, not bytes.
