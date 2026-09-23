---
description: Use for lead lookup, stage and history questions, lead tasks, WhatsApp conversations and follow-ups, email drafting or sending, meeting availability or booking, and lead files.
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

## WhatsApp

`get_lead_whatsapp` → `prepare_lead_whatsapp_message` → owner approval →
`send_lead_whatsapp_message`. The destination is the lead's own primary phone,
resolved by `lib/domain/leads/whatsapp`; free text only inside the 24-hour
reply window, otherwise an approved template with recorded consent. Report
"already sent" as not sent again and "provider unavailable" as nothing sent.
Inbound messages, delivery statuses, consent and reconciliation are recorded
only by the verified webhook or a person in the app — never from model text.

## Examples

- “What stage is Harpreet in?” asks which Harpreet when scoped search is plural.
- “Email this lead” returns a draft before any send approval.
- “WhatsApp Sam that we're running late” previews the message, then asks to send.
- “Did Sam reply on WhatsApp?” answers only from the persisted thread.
- “Show signed plans” returns safe metadata and an authorized app link, not bytes.
