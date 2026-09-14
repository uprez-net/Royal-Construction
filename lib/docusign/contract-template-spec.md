# DocuSign Contract Template — MBA BC4 (March 2025, NSW)

The building Contract is the MBA-copyrighted "Residential Building (BC4)"
standard form, so it is NOT generated at runtime like the Tender. A DocuSign
**template** holds the clean blank BC4 PDF plus all signature and data tabs;
`sendContractForSignature` (lib/data/offer-contract-sign.ts) creates envelopes
from it and fills values from the signed Tender by **tab label**.

## The template is created by script, not by hand

```
pnpm exec tsx scripts/docusign/create-bc4-template.ts <path-to-blank-BC4.pdf>
```

The MBA webform export embeds its merge-field tokens as invisible text at
every fill position (`contract_price_value`, `site_address_value`,
`signed_by_owners_value`, …). Every tab AutoPlaces onto those anchors, so the
template needs no manual field placement and is fully reproducible — edit the
script and re-run it, then update `DOCUSIGN_CONTRACT_TEMPLATE_ID` in the env.

A token that appears in several places yields a tab at every occurrence
(contract price on pages i + ii, bank details on pages iii + vi) — one label
fills them all.

## Roles (customer-first, issue #98)

- `Owner` — routing **1**. The primary/authorised signatory, **signs first**,
  and carries **every value on the contract** so the customer sees a complete
  document the moment they open it: derived Tender values + the estimator's BC4
  particulars (all locked/read-only), the builder-identity constants (locked),
  the pre-ticked Schedule 1 checklist (locked) — plus the owner's own fields:
  agreement signature, Schedule 1 acknowledgment signature + date + print name +
  capacity, and the agreement date sentence (day / month / year).
- `Builder` — routing **2**. Counter-signs to execute; carries only its
  signature (no data tabs).

Why all data is on the Owner role: with customer-first routing the Builder signs
second, and DocuSign does not show a later recipient's field values to an earlier
signer by default (verified on a real envelope — the customer saw a blank
contract). A locked tab with a value renders read-only to its OWN recipient, so
assigning the data to the first signer is the DocuSign-native fix — no dependency
on the "write initial value for all recipients" account setting.

Schedule 1's 17 statutory checklist "Yes" boxes are pre-ticked and locked in
the template.

## Labels the send action fills (locked at envelope time)

| Tab label | Anchor token | Value |
|---|---|---|
| `contractPrice` | `contract_price_value` (pages i + ii) | tender contract sum |
| `contractPriceTotal` | `total_value` (Schedule 2) | tender contract sum |
| `ownerNames` | `owners_0_owner_name_value` | job.clientNames |
| `ownerEmail` | `owners_0_owner_email_value` | client email |
| `siteAddress` | `site_address_value` | job.siteAddress |
| `variationPercent` | `percentage_allowed_on_variations_value` | "10%" |
| `paymentSchedule` | `installments_0_installment_item_value` | every stage of the signed Tender's schedule, compact single field (percent as printed, e.g. 2.5%; amounts to the cent) |
| `depositAmount` | `deposit_value` | the signed Tender's deposit stage amount |

The schedule and deposit come from `Tender.documentData` (the `paymentTerms`
block stamped at send, or the stored render input for older Tenders), falling
back to the agreed snapshot only when neither is readable; the contract price
stays the agreed snapshot's. A Tender whose printed price differs from it (in
whole cents) is refused before the envelope is created
(`lib/offer/contract-payment-source.ts`).
| `excludedDays` | `days_not_included_value` | "Saturdays, Sundays and NSW Public Holidays" |
| `defectsLiabilityWeeks` | `defects_liability_period_value` | "12 Weeks" |
| `workDescription` | `description_of_the_work_to_be_completed_value` | buildType + buildScope |
| `exclusionsList` | `exclusions_value` | the Tender's exclusions: draft bullets plus Scope exclusions ticked for the document, deduplicated as the Tender prints them |
| `ownerPrintName` | `acknowledgement_of_owner_docusign_0_name_value` | first owner (Owner role) |

Checkboxes set by the action: `gstInclusive`, `hbcfIncluded`, `exclusionsYes`.

BC4 particulars — captured in-app during the contract draft (issue #98) and sent
as **locked** Owner-role tabs; a blank one stays the template's locked-empty tab
(read-only): `ownerAddress`, `ownerPhone`, `ownerMobile`, `lendingAuthority`,
`fundingOwner`, `hbcfCost`, `paymentDays`, `interestRate`, `commencementDate`,
`constructionDays`, `demolitionMaterials`, `preContractCosts`,
`specialConditions`. (Formerly unlocked fields the builder completed while
signing — no longer, since the customer signs first.)

Owner-completed fields (unlocked, the owner fills during signing): `signedDay`,
`signedMonth`, `signedYear`, `ownerCapacity`, plus the two owner acknowledgment
checkboxes.

Note on Schedule 2 payments: the blank form prints a single stage row (the MBA
webform reflows per-row), so all stages render in one compact field —
"(1) Deposit 5% $47,250.00 | (2) Slab 15% …". If a fuller layout is ever
needed, attach a generated payment-schedule annexure to the envelope (the form
itself invites attached schedules).

## Multi-owner / director signers (implemented — issues #103, #111, #120; ADR 0003)

The offer models `owners[]` (individuals + companies with N director signatories).
Every owner is **named** on the contract (`ownerNames` = `formatOwnerNamesLine`,
e.g. "A & B & ABC Pty Ltd (ABN/ACN …)") and each signer is a **separate DocuSign
recipient** (routing 1, parallel) with its own tracked link + `EnvelopeSignature`
row (capacity/entity). The base template is **not** regenerated — this is all done
at send time.

### The constraint (confirmed from the PDF)

`pdftotext` on the blank BC4 shows only `owners_0_*` tokens + a single
`signed_by_owners_value` anchor (the MBA webform reflows single `_0_` rows), and
the `SIGNED BY THE OWNER(S)` area has ~59pt of clear space before the Builder line
— room for the primary **+ ~1** signature only. So extra signatures cannot stack in
that area.

### Approach: primary on the form, everyone else on an appended schedule

- **N = 1** — the plain `templateId` + `templateRoles` path (Builder + Owner),
  unchanged and known-good.
- **N > 1** — the send generates an **"Owner Signature Schedule"** PDF
  (`lib/offer/contract-annexure-html.ts` → `generatePDF`), one clean block per
  co-owner/director with `sigAnnex{k}` / `dateAnnex{k}` anchor tokens, and builds
  the envelope from **two composite-template layers**:
  1. the BC4 server template with `Builder` + primary `Owner` (all data tabs; the
     primary signs the BC4 form's owner line);
  2. an inline layer that **adds the schedule as document 2** plus signers 2..N,
     each `signHere`/`dateSigned` anchored on `sigAnnex{k}`/`dateAnnex{k}`.
  The document **must** be its own composite layer — a document placed inside the
  server-template layer's inline template is silently dropped (verified).
- Composite templates **re-number recipientIds**, so the send reads recipients back
  via `listRecipients` and maps capacity/entity by roleName (`Builder` / `Owner` /
  `AnnexOwner{k}`); the recorded id then matches the Connect webhook's.
- **Bounded max** = 10 signatories (`offer-contract-sign.ts`); beyond that the send
  is refused with a clear message (never silently dropped). Data tabs stay on the
  primary Owner so the customer opens a complete contract (customer-first, #98).

`createContractEnvelope` takes an ordered `owners: {name,email,capacity,entityName,
entityAbn}[]` + `annexurePdfBase64`; `collectOfferSigners(owners)` is the shared
ordered list (same one the Tender uses).

### Verified (sandbox — account-d/demo)

A 4-signer send (2 individuals + 1 company × 2 directors) confirmed: document 2
(the schedule) is attached; the primary signs the BC4 form (p5 owner line + p7
acknowledgment); the builder counter-signs (p5); the 3 co-owners/directors each get
a `sigAnnex` tab on the schedule (y = 220 / 331 / 442, no overlap); every signer is
a distinct RO-1 recipient with its own link; recipientIds + capacity/entity read
back correctly. Remaining: exercise the full `sendContractForSignature` path (a
real CONTRACT_DRAFT offer) end-to-end, and confirm the Connect webhook updates each
`EnvelopeSignature` by the read-back recipientId.
