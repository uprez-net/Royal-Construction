# Offers (Quotations Bounded Context)

Royal Constructions moves a **Lead** from qualification through **Offer** negotiation, **Tender** signing, **Contract**, and **Project** execution. An Offer captures assumptions, scope (inclusions and exclusions), internal costing, and customer-facing negotiation before the legal Tender is issued.

## End-to-end workflow (decided direction)

```text
Lead → Offer (build → send → negotiate → agreed)
     → Tender (payment schedule → generate → DocuSign sign: builder + customer)
     → Contract (generate → DocuSign sign) → Project → Costing report
```

Three workflow **phases** drive the top-card stepper — **Offer**, **Tender**, **Contract** — after which the signed Contract is **handed off to Project**.

| Phase | What happens | Primary document | Stepper steps |
|-------|----------------|------------------|---------------|
| Lead | Qualification, plans, lead discussion | — | — |
| **Offer** | Assumptions, internal costing, pricing, inclusions/exclusions; Offer document generated, **sent through the system**, client negotiates, revisions, **agreed** | **Offer document** (summary for negotiation) | Job setup · Cost schedule · Pricing · Scope · Offer document · Send & negotiate |
| **Tender** | After **agreed**: payment schedule decided, fixed-price **Tender** generated and sent via **DocuSign**; signed by **builder and customer** | **Tender** (legal) | Tender |
| **Contract** | Contract **generated in-app** from Tender data, sent via **DocuSign**; signed by both parties | **Contract** | Contract |
| Project (handoff) | Created once the **Contract is signed**; job execution, budget vs actual tracked | **Costing report** (SAMPLE QUOTE pattern) | Project |

_Avoid_: Treating negotiation PDF and signed Tender as the same document; off-system MBA upload as the contract system of record (superseded — see ADR 0001); creating Project before the Contract is signed

## Language

**Offer**:
The pre-contract work package on a **Lead** — internal costing, scope decisions, customer negotiation, and revisions — from first draft until the job is ready to issue the legal **Tender**. Not the same as the negotiation **Offer document** PDF alone.
_Avoid_: Quote, quotation, using Offer to mean the signed legal package

**Offer document** (decided):
The **customer-facing negotiation output** — a **summary one-pager** (v1): cover (client, site, ref), bullet **inclusions** and **exclusions**, single **contract value (inc GST)**, and validity. **No numbered inclusion table** on the Offer document; that appears on the **Tender** after **Offer agreed**. Sent in **revisions** during negotiation.
_Avoid_: Tender (legal package), full Tender sections during negotiation

**Building Proposal** (observed legacy label):
A customer-facing proposal document title used in existing Dropbox files. In this context it maps to **Offer document** when it is a pre-signature proposal/negotiation output; it is not the signed legal **Tender** unless the document itself contains Tender acceptance/signature evidence.
_Avoid_: Treating the proposal title as proof of Tender status

**Offer internal work** (decided):
During **Offer** creation the builder runs the **full internal cost schedule** (stages A–O, contract build-up, margin analysis, inclusion–cost linking) from assumptions and plans. This work is **never shown to the client** on the Offer document. It drives the one-pager total and seeds the **Tender** inclusion table when the Offer is **agreed**.
_Avoid_: Skipping internal costing until Tender, exposing margin or trade lines on the Offer document

**Tender** (decided direction):
The **final legal fixed-price document** issued after negotiation is settled. Full client metadata, inclusion tables with status, payment schedule, exclusions, terms and conditions, and **acceptance** signed by **builder and customer**. Maps to `Royal Constructions TENDER TEMPLATE v3 (NCC 2025).docx`. Distinct from the negotiation **Offer document**.
_Avoid_: Offer document, quotation PDF

**Contract** (decided — supersedes off-system upload; see ADR 0001):
The **legal building contract** generated **in-app** from the signed **Tender** data, then sent for e-signature via **DocuSign** (a DocuSign template pulls the app-supplied fields). Signed by **builder and customer** in DocuSign; the executed PDF returns to the Offer as system of record. Distinct from the signed **Tender**.
_Avoid_: Off-system MBA portal as system of record, manual signed-PDF upload as the contract path, treating Tender sign as Contract sign

**Contract upload** (superseded):
Former off-system model (external MBA portal + manual signed-PDF upload). Replaced by in-app **Contract** generation + **DocuSign** e-signature — see **Contract** and ADR 0001.

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

**Offer status** (decided — extended for the Contract phase; see ADR 0001):
The **Offer** entity tracks the full lifecycle: **pending**, **sent**, **agreed**, **tender_draft**, **tender_sent** (DocuSign out for signature), **tender_signed**, **contract_draft**, **contract_sent** (DocuSign out), **contract_signed**, **rejected**, **superseded**. **Project** is created once **contract_signed** (no deposit or upload gate). Status drives the top-card stepper's active node and phase.
_Avoid_: Offer status ending at "agreed" or "tender_signed" with no contract states, deposit/upload as a Project gate

**Offer handoff** (decided — supersedes the 3-item checklist; see ADR 0001):
**Create Project** is gated solely on **contract_signed** (Contract executed via DocuSign). The former three-item checklist (signed Tender PDF + uploaded MBA Contract PDF + initial payment) is **dropped**: signing is in-app via DocuSign and the deposit is no longer a handoff precondition (tracked in Project financials instead).
_Avoid_: Deposit or PDF-upload as a Project precondition, Project before contract_signed

**Marking an Offer sent** (decided):
**Download Offer document** while pending does not change status. **Send Offer document** emails the one-pager with a **tracked link** (open telemetry) and sets **sent**. The customer **replies by email**; staff **log the requested changes** and create a **new revision** (v1 has **no customer self-service portal**). Distinct from sending the final **Tender** via DocuSign.
_Avoid_: Auto-sent on PDF download, customer self-service portal in v1, sending Tender during negotiation

**Offer agreed** (decided):
Estimator marks when the client and builder have **settled scope and price** after negotiation. **Freezes** the internal snapshot and **auto-generates** the full **Tender** — numbered inclusion items, statuses, payment schedule, T&C, and acceptance — from internal cost schedule + catalog mapping. Estimator **reviews and edits** Tender before send. Does not mean Tender is signed yet.
_Avoid_: Using “agreed” to mean Tender signed, manual re-keying of Tender from the one-pager bullets

**Tender generation** (decided):
On **Offer agreed**, the app builds the **Tender** from internal data (inclusion items, statuses, contract value, metadata). The **Offer document** one-pager bullets may be **auto-summarized** from the same source during negotiation; the generated Tender is the authoritative detailed scope for legal sign-off.
_Avoid_: Tender built only from one-pager bullets, blank Tender at agree

**Tender signed** (decided — via DocuSign; see ADR 0001):
Both **builder and customer** have signed the **Tender** through **DocuSign**. The executed PDF returns to the Offer automatically on envelope completion. Precedes in-app **Contract** generation.
_Avoid_: Manual signed-PDF upload as the signing path, marking signed without a completed DocuSign envelope

**Marking an Offer rejected** (decided):
Estimator **Mark rejected** when the client declines during or after negotiation. **Rejected reason** is **required**. Enables **New revision** from a rejected Offer.
_Avoid_: Auto-reject on validity expiry (v1), rejected without reason

**Initial payment** (decided — no longer a Project gate; see ADR 0001):
First client payment (typically a tender deposit), **flexible amount**. Tracked against the Offer/Project for financials but **not a precondition** for **Create Project**. Handoff is gated on **contract_signed** alone.
_Avoid_: Deposit as a Project gate, blocking handoff on payment

**Project from Offer** (decided — gated on contract_signed; see ADR 0001):
**Project** is created once the Offer reaches **contract_signed** (Contract executed via DocuSign). Pre-filled from Lead, Offer, Tender, and Contract. On creation, seed the **Costing report** from internal cost lines via SAMPLE crosswalk.
_Avoid_: Project on Tender sign alone, Project before Contract signed, deposit/upload preconditions

**Project from accepted Offer** (superseded wording):
See **Project from Offer** — now **contract_signed → Project** (no upload or deposit gate).

**Contract signed** (decided — via DocuSign; see ADR 0001):
Both **builder and customer** have signed the app-generated **Contract** through **DocuSign**; the executed PDF returns to the Offer on envelope completion. The sole gate for **Create Project**.
_Avoid_: Treating Tender signed as Contract signed, upload/deposit as an additional gate

**Payment schedule** (decided):
The staged payment breakdown (deposit, base/frame/lock-up/fixing/completion, etc.) decided in the **Tender** phase after **agreed**, before **Tender generation**. Seeds the Tender's payment schedule and downstream Project milestones.
_Avoid_: Deciding the schedule on the Offer document during negotiation, treating it as a customer-facing Offer artifact

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

**Offer/Tender wording** (decided):
The customer-visible narrative sentence that explains a costing task on the **Offer document** or generated **Tender** without exposing the internal cost, margin, trade quote, or supplier line. It may summarize one or many **Building sequence tasks**.
_Avoid_: Cost line, priced row, trade booking instruction

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

When a **Project** is created from a **Contract**, the Offer’s internal cost schedule seeds the **Costing report** (SAMPLE crosswalk). A valid Project milestone source, budget mapping, and materials may follow in a later **Pricing Model** pass.

**Building Sequence** (decided):
The ordered Project execution checklist created after **Project from Offer**. It breaks accepted scope into site tasks that can be scheduled, inspected, and booked with trades; sequence identifiers are ordering aids, not stable commercial references.
_Avoid_: Internal cost schedule, Tender inclusion table

**Building sequence task** (decided):
One executable task in the **Building Sequence**, such as peg-out survey, piering and pouring, frame inspection, waterproofing inspection, or driveway pour. It may trace back to one **Cost line** task during Offer costing and may roll up into one **Offer/Tender wording** sentence.
_Avoid_: Cost line, inclusion item

**Trade to book** (decided):
The trade or coordinator role that should be booked for a **Building sequence task** during Project execution. It is downstream handoff metadata and does not appear as customer-facing Offer/Tender wording.
_Avoid_: Trade/vendor cost field, customer-visible contractor list

**Stage/milestone mapping source** (rejected):
The workbook's stage/milestone mapping is not an authoritative relationship for Offer, Tender, or Project creation. Ignore it until Royal Constructions defines a separate valid Project milestone source.
_Avoid_: Using workbook stage/milestone labels to drive Offer/Tender wording or Project creation

## Planned (deferred)

**Pricing Model** — a dedicated section to define later, separate from Offer/Tender document structure. Expected to cover org-wide and per-job pricing rules not yet locked in this glossary, for example:

- `SETTINGS` defaults (margin floor/target, GST, HBCF rate, admin, PM, contingency)
- Per-m² rate card and build-type multipliers
- Multi-dwelling cost allocation across offer price rows
- PC allowance caps and variation triggers
- Valid Project milestone source and budget mapping on project handoff

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
