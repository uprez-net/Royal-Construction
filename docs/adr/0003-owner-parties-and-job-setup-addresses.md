# 3. Owner parties (individuals & companies) and addresses captured on Job setup

Date: 2026-07-23

## Status

Accepted. Extends ADR 0002 (offer workspace persistence) and ADR 0001 (DocuSign e-signature).
Drives issues #109, #110, #111, #120, #103.

## Context

Issue #109 asks to split the Lead's single `location` into "Current Location" (where the
client lives) and "Site Location" (the build site), and to show both — clearly labelled — on
the Offer document, Tender, and Contract. A cluster of adjacent issues shares the same root:
the customer is modelled as **one or two natural persons** carried as free text
(`clientNames` + one `secondaryCustomerName`), split into signers by `splitOwners()` on
`&`/`and`. That cannot represent >2 owners (#111), a company customer with director
signatories (#103), sending the contract to every owner (#120), or a mandatory client email
(#110, currently `.optional()` in the lead schema). Only the Contract carries a client
address today (`ContractParticulars.ownerAddress`, hand-typed at contract-draft time,
unlinked from the Lead/Offer). The Customer row has no address column at all.

The BC4 (MBA) Contract is a **static DocuSign template** whose "WHO" block has a **single**
`OWNER(S):` name line, a single `of …` address line, one contact block, and one
`SIGNED BY THE OWNER(S):` signature area — there are no per-owner slots on the form face.

## Decision

**1. Keep the Lead lightweight; capture addresses on Job setup.** The Lead keeps its single,
loose `location` (suburb-grade capture hint). The two contract-grade addresses
(**Current Location**, **Site Location**) are captured on the Offer **Job setup** step, seeded
from `lead.location → Site Location`. We consciously **diverge from #109's literal
"on the leads page + list" AC** — the leads page/list is unchanged. Both addresses use the
existing `/api/address` autocomplete; Site Location additionally captures council/state/
postcode, feeding `Project.council` at handoff (replacing the hardcoded `"TBC"`).

**2. Model the customer side as `owners[]`.** Each Owner is an **Individual** (name, email,
phone, Current Location) or a **Company owner** (company name, ABN/ACN, registered office)
carrying one or more **Director signatories** (name, email, capacity). This replaces the
primary + single-secondary ceiling and lives in `Offer.workspaceState.job.owners[]`
(JSON, per ADR 0002), migrated-on-read from the old `clientNames`/`secondaryCustomer*`
fields with a `schemaVersion` bump.

**3. Every party signs; capacity is metadata, not a role.** Each Individual Owner signs
(capacity "Owner"); each Company owner signs through its Director signatories (capacity
"Director", tagged with the represented company + ABN/ACN). All customer-side signers use
routingOrder 1 (parallel); the builder counter-signs last (routingOrder 2). `SignerRole`
stays `BUILDER | CUSTOMER`; `EnvelopeSignature` gains `capacity` + represented-entity
columns. Each signer is a distinct DocuSign recipient with its own tracked link + status
(#120). The Tender already routes N owner-signers; the Contract is extended to match.

**4. Base BC4 template retained; an appended signature schedule carries the extra signers.**
_(Shipped design — supersedes the earlier "regenerate the template and stack every signature
in the one owner area" plan, which is NOT what was built.)_ We keep the existing BC4 template
and **do not mint a new `DOCUSIGN_CONTRACT_TEMPLATE_ID`**; the app composes the used recipients
+ locked tabs at send time via composite templates (single-signer offers use the plain
`templateRoles` path; multi-signer offers add a server template whose document 2 is the
generated annexure). Because the form has one owner area, **all owners are named on the
`OWNER(S):` line** and the primary owner's Current Location / phone / mobile / email fill the
`of …` and contact lines. The **primary** owner signs the form's single
`SIGNED BY THE OWNER(S):` area; every **additional** owner/director signs an app-generated
**Owner Signature Schedule** appended as a second document (one signature block each). The
total signatory count is capped at `MAX_OWNER_SIGNERS` (10) and the offer/Tender/Contract owner
gates refuse more rather than silently dropping a signer. Full per-owner addresses/contacts
still render on our own Tender HTML and in-app.

**5. Document rendering.** Both addresses are labelled on all three documents. The legal
Tender + Contract additionally print each owner's email + phone; the customer-facing Offer
one-pager shows party names + both addresses only (no contact clutter).

**6. Mandatory email (#110).** The Lead's primary email becomes required + valid at the schema
level; every owner's email is validated (non-placeholder) at the Send / Tender / Contract
gates.

**7. Handoff.** The primary Customer row gains an `address` column (its Current Location); the
full `owners[]` (all parties, company/director, both addresses, per-owner contact) persists
as structured JSON on the Project (`Project.parties`). Site → `Project.location` + `council`.

## Consequences

- **Migration + template work is non-trivial:** `schemaVersion` bump with migrate-on-read for
  `job.owners[]`, new columns (`Customer.address`, `Project.parties`, `EnvelopeSignature`
  capacity/entity), a regenerated BC4 template + new template ID + staging webhook re-test.
- **`splitOwners()` heuristic is retired** for new data; kept only to migrate legacy
  `clientNames` into `owners[]`.
- **Contract face vs. richness gap:** the BC4 form shows only the primary owner's
  address/contact; co-owner richness lives on the Tender + in-app, not the contract face
  (accepted trade-off; a co-owner Schedule page was considered and deferred).
- **Bounded-max cap:** jobs beyond ~4 owners / ~3 directors need a manual fallback; logged, not
  silently truncated.
- **Reversible at cost:** promoting `job.owners[]` / `Project.parties` JSON to normalized
  tables later is a standard migration if a downstream feature needs to query them.
