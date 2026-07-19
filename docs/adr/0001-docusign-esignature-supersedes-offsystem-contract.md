# 1. DocuSign e-signature supersedes off-system contract upload

Date: 2026-07-02

## Status

Accepted (supersedes the prior "off-system MBA portal + signed-PDF upload" direction recorded in CONTEXT.md).

## Context

The originally decided flow signed the **Tender** and **Contract** outside the app: the Tender was signed and its PDF uploaded, and the **Contract** was completed on an external MBA portal, signed offline, and uploaded as the system of record. The app deliberately did not generate contracts. **Project** creation was gated by a three-item handoff checklist (signed Tender PDF + uploaded Contract PDF + initial payment).

The team now wants signing to happen **through the system**: after an Offer is **agreed**, the app generates the **Tender**, sends it via **DocuSign** for the builder and customer to sign, then generates the **Contract** from the signed Tender data and sends that via **DocuSign** as well. A DocuSign template pulls app-supplied fields. This keeps the whole lifecycle (Offer → Tender → Contract → Project) inside one system with a single audit trail, and removes manual PDF handling.

## Decision

Adopt **DocuSign e-signature** for both the **Tender** and the **Contract**, and **generate the Contract in-app** from Tender data. Drop the external MBA portal and the manual signed-PDF upload as the system of record. The workflow is organised into three phases — **Offer, Tender, Contract** — after which the signed Contract is handed off to **Project**.

## Consequences

- **New integration surface:** DocuSign envelope creation, template/field mapping, embedded or emailed signing, and a completion webhook that returns the executed PDF and advances status. This is a significant build not previously scoped.
- **Contract generation is now in-app:** requires a Contract template and a field-mapping from Offer/Tender data (previously explicitly out of scope).
- **Status model expands:** the Offer lifecycle needs Tender-signing and Contract states (e.g. `tender_sent`/`tender_signed`, `contract_draft`/`contract_sent`/`contract_signed`) driven by DocuSign events rather than manual uploads.
- **Handoff redefined:** "Contract signed" is the **sole** gate to Project. The old three-item checklist (signed Tender PDF + uploaded Contract PDF + initial payment) is dropped; the deposit is tracked in Project financials but no longer gates handoff.
- **Negotiation channel (v1):** the Offer document is emailed with a tracked link; the customer replies by email and staff log requested changes into a new revision. No customer self-service portal in v1.
- **Upload path retained only as fallback (if at all):** manual upload is no longer the system of record; keep it, if kept, purely as a manual override.
- **Reversible only at cost:** unwinding back to off-system upload after building the DocuSign + contract-generation pipeline would waste that integration work.
