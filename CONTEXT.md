# Offers (Quotations Bounded Context)

Royal Constructions moves a **Lead** from qualification through **Offer** negotiation, **Tender** signing, **Contract**, and **Project** execution. An Offer captures assumptions, scope (inclusions and exclusions), internal costing, and customer-facing negotiation before the legal Tender is issued.

## End-to-end workflow (decided direction)

```text
Lead → Offer (negotiate) → Tender signed → MBA Contract signed off-system → Contract uploaded → Project → Costing report
```

| Phase | What happens | Primary document |
|-------|----------------|------------------|
| Lead | Qualification, plans, lead discussion | — |
| Offer | Assumptions, internal costing, inclusions/exclusions discussed; client negotiates price and scope | **Offer document** (summary for negotiation) |
| Tender | Full fixed-price package after agreement; signed by **builder and customer** | **Tender** (legal) |
| Handoff | Signed Tender, MBA Contract upload, initial payment | All three required before Project |
| Project | Job execution; budget vs actual tracked | **Costing report** (SAMPLE QUOTE pattern) |

_Avoid_: Treating negotiation PDF and signed Tender as the same document; creating Project before Contract

## Language

**Offer**:
The pre-contract work package on a **Lead** — internal costing, scope decisions, customer negotiation, and revisions — from first draft until the job is ready to issue the legal **Tender**. Not the same as the negotiation **Offer document** PDF alone.
_Avoid_: Quote, quotation, using Offer to mean the signed legal package

**Offer document** (decided):
The **customer-facing negotiation output** — a **summary one-pager** (v1): cover (client, site, ref), bullet **inclusions** and **exclusions**, single **contract value (inc GST)**, and validity. **No numbered inclusion table** on the Offer document; that appears on the **Tender** after **Offer agreed**. Sent in **revisions** during negotiation.
_Avoid_: Tender (legal package), full Tender sections during negotiation

**Offer internal work** (decided):
During **Offer** creation the builder runs the **full internal cost schedule** (stages A–O, contract build-up, margin analysis, inclusion–cost linking) from assumptions and plans. This work is **never shown to the client** on the Offer document. It drives the one-pager total and seeds the **Tender** inclusion table when the Offer is **agreed**.
_Avoid_: Skipping internal costing until Tender, exposing margin or trade lines on the Offer document

**Tender** (decided direction):
The **final legal fixed-price document** issued after negotiation is settled. Full client metadata, inclusion tables with status, payment schedule, exclusions, terms and conditions, and **acceptance** signed by **builder and customer**. Maps to `Royal Constructions TENDER TEMPLATE v3 (NCC 2025).docx`. Distinct from the negotiation **Offer document**.
_Avoid_: Offer document, quotation PDF

**Contract** (decided):
Royal Construction uses an **MBA contract**, completed via an **external portal** (outside this app), signed offline, then **uploaded** to the Offer as the signed Contract PDF. The app does **not** fill or generate MBA contracts — upload is the system of record. Distinct from the signed **Tender**.
_Avoid_: In-app MBA merge/generation, treating Tender upload as Contract

**Contract upload** (decided):
After **tender_signed**, staff complete the MBA contract on the **external portal**, collect signatures offline, and **upload** the signed Contract PDF to the Offer. Optional metadata: contract date, MBA reference.
_Avoid_: Project before Contract upload, generating Contract inside the app in v1

**Costing report** (decided):
The **Project-phase** budget tracker — quote (budget) vs actual vs variance per trade line, plus invoices. Maps to `SAMPLE QUOTE.xlsx` (`SAMPLE QUOTE` + `costing report` sheets). Seeded from the accepted Offer’s internal cost lines via the **catalog crosswalk** when the **Project** is created. Not used during Offer negotiation with the client.
_Avoid_: Internal cost schedule (Offer-phase name), quote spreadsheet (file name only)

**Lead**:
A prospective client and their project opportunity. A Lead may have **many Offers** over time; exactly one Offer is **active** at a time unless explicitly superseded.
_Avoid_: One quote per lead (legacy assumption)

**Offer workspace entry** (decided):
Opening the offer workspace for a Lead **resumes the active Offer** while it is in **pending**, **sent**, or negotiable pre-**agreed** states. **Agreed** (Tender phase), **Tender signed**, **rejected**, and **superseded** Offers open read-only for their phase. **New revision** forks from the current active Offer (copies internal cost schedule and Offer document content).
_Avoid_: Always new revision, editing a signed Tender in place

**Offer revision** (decided):
Creating a new Offer for the same Lead starts a new revision during **negotiation and Tender drafting** — while status is before **tender_signed**. Prior Offers become **superseded**. **New revision** may fork from pending, sent, rejected, or pre-sign Tender states. **After tender_signed**, the Offer is **locked**; scope or price changes use **Variations** on the **Project** (or formal contract amendment off-system). Revisions preserve audit history.
_Avoid_: Overwriting the same Offer record in place, new Offer revision after Tender signed

**Offer reference** (decided):
One **single base reference** per Offer family on a Lead (e.g. `RC-Q-2026-001`). **New revision** appends a revision suffix (e.g. `RC-Q-2026-001-R2`). The same reference appears on the internal cost schedule, Offer document, Tender, Contract, and list UI. No separate RC-T numbering.
_Avoid_: Paired RC-Q / RC-T refs, new sequential ref per revision (002, 003)

**Lead discussion**:
The persistent conversation and context about a **Lead** before and across Offers — qualification, scope, notes, uploaded files, and early agent messages. Created on first engagement with the Lead. **Available on every Offer revision** as context for the agent and for estimators; not replaced when a new revision starts.
_Avoid_: Lead chat (implementation name only)

**Offer chat** (decided):
Each **Offer revision** has its own working chat for costing and Tender drafting. **New revision** starts a **fresh Offer chat**; it does not copy prior revision chat transcripts. The agent and UI still have access to **Lead discussion** (and forked cost schedule / Tender) on every version, including the first.
_Avoid_: One chat per Lead for all revisions (current code behaviour)

**Offer workspace UI** (decided):
The main chat panel shows **Offer chat only**. **Lead discussion** is injected as **agent context** (transcript summary and/or messages + files) on every revision; it is not shown as a separate transcript panel in v1.
_Avoid_: Unified lead+offer timeline, side-by-side lead transcript panel (deferred)

**Offer status** (decided):
The **Offer** entity tracks status through **tender_signed**: **pending**, **sent**, **agreed**, **tender_draft** / **tender_sent**, **tender_signed**, **rejected**, **superseded**. Handoff checklist (Tender PDF, Contract upload, initial payment) applies after **tender_signed**. **Project** once all three are complete.
_Avoid_: Separate Tender/Contract records in v1, Offer status ending at “agreed” with no tender_signed state

**Offer handoff checklist** (decided):
After **tender_signed**, **Create Project** requires **all three**: (1) **signed Tender PDF** on the Offer, (2) **uploaded signed MBA Contract PDF**, and (3) **initial payment recorded**. MBA Contract is completed off-system via the external portal. Deposit amount is **flexible** (org default with per-Offer override when recording).
_Avoid_: Project missing any checklist item, in-app MBA contract generation

**Marking an Offer sent** (decided direction):
**Download Offer document** while pending does not change status. **Send Offer document** (in-app or mark as sent) sets **sent** when the negotiation package goes to the client. Distinct from sending the final **Tender**.
_Avoid_: Auto-sent on PDF download, sending Tender during negotiation phase

**Offer agreed** (decided):
Estimator marks when the client and builder have **settled scope and price** after negotiation. **Freezes** the internal snapshot and **auto-generates** the full **Tender** — numbered inclusion items, statuses, payment schedule, T&C, and acceptance — from internal cost schedule + catalog mapping. Estimator **reviews and edits** Tender before send. Does not mean Tender is signed yet.
_Avoid_: Using “agreed” to mean Tender signed, manual re-keying of Tender from the one-pager bullets

**Tender generation** (decided):
On **Offer agreed**, the app builds the **Tender** from internal data (inclusion items, statuses, contract value, metadata). The **Offer document** one-pager bullets may be **auto-summarized** from the same source during negotiation; the generated Tender is the authoritative detailed scope for legal sign-off.
_Avoid_: Tender built only from one-pager bullets, blank Tender at agree

**Tender signed** (decided):
Both **builder and customer** have signed the **Tender** acceptance. **Signed Tender PDF** uploaded to the Offer. Required before Contract upload and **Project** creation.
_Avoid_: Marking tender signed without signed Tender PDF on file

**Marking an Offer rejected** (decided):
Estimator **Mark rejected** when the client declines during or after negotiation. **Rejected reason** is **required**. Enables **New revision** from a rejected Offer.
_Avoid_: Auto-reject on validity expiry (v1), rejected without reason

**Initial payment** (decided):
First client payment tied to the Offer — typically tender deposit; **flexible amount** (org default with per-Offer override when recording). **Third handoff checklist item** with signed Tender and uploaded Contract — all three required before **Create Project**. Optional **admin override** if deposit incomplete.
_Avoid_: Fixed-only deposit with no override path, Project without deposit recorded

**Project from Offer** (decided):
**Project** is created when the Offer has **signed Tender PDF**, **uploaded MBA Contract PDF**, and **initial payment recorded**. Pre-filled from Lead, Offer, and Tender. On creation, seed the **Costing report** from internal cost lines via SAMPLE crosswalk.
_Avoid_: Project on Tender sign alone, Project before Contract upload or deposit

**Project from accepted Offer** (superseded wording):
See **Project from Offer** — **tender_signed + Contract upload + initial payment → Project**.

**Offer editing persistence** (decided):
While an Offer is in **pending**, **sent**, or pre-**agreed** negotiation, changes to the internal cost schedule and **Offer document** **auto-save** (debounced). Once **agreed**, the agreed snapshot is frozen for Tender generation. Tender, Contract, and superseded Offers are read-only.
_Avoid_: Save-only with data loss on refresh, editing agreed snapshot in place without new revision

**Offer line item**:
Legacy name for a priced row. Prefer **Offer price row** (customer summary) or **Cost line** (internal).
_Avoid_: Quote item (legacy code name)

**Inclusion**:
Scope included in the build — discussed during **Offer** creation and reflected on the **Offer document** and **Tender**.
_Avoid_: Service inclusion (UI label only)

**Exclusion**:
Scope explicitly not in the contract — discussed during **Offer** creation; listed on **Offer document** and Tender Section 5 / `ALLOWANCES` sheet.
_Avoid_: Service exclusion (UI label only)

## Documents by phase

| Phase | Builder-only | Customer-facing |
|-------|--------------|-----------------|
| **Offer** | Internal cost schedule + full inclusion/cost linking (A–O, margin) | **Offer document** (one-pager: bullets + total) |
| **Tender** | Same internal schedule (frozen at agree) | **Tender** (full legal + numbered inclusions, Word v3) |
| **Contract** | — | **MBA Contract** — external portal, upload signed PDF |
| **Project** | **Costing report** (SAMPLE QUOTE pattern) | Progress reports (out of scope here) |

Every **Offer** maintains an **internal cost schedule** during costing and negotiation. It is never sent to the client. It seeds the **Costing report** when the **Project** starts.

**Internal cost schedule**:
The builder-only costing workbook (`QUOTE` sheet / v2 template). Cost lines in **cost stages** A–O with trade, notes, and cost (ex-GST). Built during **Offer** creation from assumptions and plans; drives **contract value** on the **Offer document** and **Tender**. Never sent to the client. At **Project** creation, lines map via crosswalk to the **Costing report** for quote vs actual tracking.
_Avoid_: Costing report (Project phase), quote spreadsheet (file name only)

**Cost stage**:
A lettered section on the internal cost schedule (A — General Requirements through O — Completion & Handover). Fixed catalog from the quote template; subtotals roll into direct cost.
_Avoid_: Milestone (project phase — related but not identical), Section 1 / Section 2 (tender document sections)

**Cost line**:
One editable row within a cost stage: item name, trade/vendor, notes, cost (ex-GST). Distinct from a tender **inclusion item** (narrative + status, no price).
_Avoid_: Offer price row, quote item

**Inclusion item**:
A numbered row on the Tender (e.g. 1.10 Site Preparation) with description and **inclusion status**. No unit cost shown to client.
_Avoid_: Cost line, service inclusion (UI label)

**Inclusion status**:
Whether an inclusion item is Included, Excluded, By Owner, Included with provisions, or Not Applicable.
_Avoid_: Offer status (workflow state)

**Inclusion status linking** (decided):
Tender inclusion statuses use **linked defaults** from the internal cost schedule, always **overridable** by the estimator. Default rules: linked cost line with amount greater than zero → `Included`; amount zero or no link → `Not Applicable`; explicit exclusion flag → `Excluded`; owner-responsibility items → `By Owner`. Estimator may override any row on the Tender without changing cost lines.
_Avoid_: Strict sync (auto-forced status changes)

**Inclusion–cost mapping** (decided):
Seed a **catalog template** mapping Tender inclusion items to QUOTE **cost stages / cost lines** (from Word + Excel templates). Used to compute linked default statuses. Mapping is **overridable** per Offer; manual links allowed where the template has no entry.
_Avoid_: Heuristic-only linking with no template, mandatory strict map with no override

**Contract build-up**:
The internal calculation chain: direct cost → HBCF → admin → PM → contingency → cost base → builder margin → subtotal (ex-GST) → GST (10%) → **contract value (inc GST)**. Defined in `SETTINGS` and `QUOTE` sheets.
_Avoid_: Grand total (without specifying inc/ex GST)

**Offer pricing settings** (decided):
Margin, HBCF rate, admin, PM, contingency, and GST use **org-wide defaults** with **per-Offer overrides** on the internal cost schedule only. Overrides affect contract build-up for that Offer; they are never shown on the Tender. Build-type-specific defaults belong in the deferred **Pricing Model** section.
_Avoid_: Global-only (no per-job tweak), per build type defaults in Offer UI (until Pricing Model)

**Prime cost (PC) allowance**:
A capped allowance for selections (tapware, tiles, appliances, etc.) on the `ALLOWANCES` sheet. Overage becomes a variation.
_Avoid_: Provisional sum (unless explicitly that contract term)

**Offer price row**:
Optional customer-facing price breakdown when an Offer covers multiple dwellings/packages (e.g. Unit 1, Unit 2). Sums to **contract value**. Default single-dwelling jobs show one total only (as in COVER sheet).
_Avoid_: Cost line

**Fixed price total**:
Same as **contract value (inc GST)** — the single number on the Tender cover and COVER sheet.
_Avoid_: Grand total (ambiguous GST)

## Downstream use

When a **Project** is created from a **Contract**, the Offer’s internal cost schedule seeds the **Costing report** (SAMPLE crosswalk). Milestone budgets and materials may follow in a later **Pricing Model** pass.

## Planned (deferred)

**Pricing Model** — a dedicated section to define later, separate from Offer/Tender document structure. Expected to cover org-wide and per-job pricing rules not yet locked in this glossary, for example:

- `SETTINGS` defaults (margin floor/target, GST, HBCF rate, admin, PM, contingency)
- Per-m² rate card and build-type multipliers
- Multi-dwelling cost allocation across offer price rows
- PC allowance caps and variation triggers
- Stage-to-milestone budget mapping on project handoff

Do not implement pricing policy in the Offer UI until this section is written.

## Flagged ambiguities

| Topic | Open question |
|-------|----------------|
| **Contract template** | **Decided:** MBA via external portal; upload only — no in-app generation |
| **Project gate** | **Decided:** signed Tender PDF + uploaded Contract PDF + initial payment recorded |
| Legacy Quote in code | Rename to **Offer** over time |
| Quotation (UI copy) | **Offer document** (negotiation) vs **Tender** (legal) |
| lineItemTool rows | **Cost lines** on internal cost schedule |

## Example dialogue

**Estimator:** "Internal schedule is costed A–O — margin is on target. Client gets the one-pager only: bullets and $680k inc GST."
**Estimator:** "Offer document v2 sent — client wants to drop pool from exclusions list and adjust stone."
**Estimator:** "Revision R3 on the Offer document — client agrees. Marking **Offer agreed**, generating Tender."
**Client:** "Signed Tender Section 7 — builder countersigned. Tender PDF uploaded."
**Admin:** "MBA contract uploaded from the portal. Deposit recorded — $8k."
**Site manager:** "Tender, Contract, and deposit all on file — creating Project."
