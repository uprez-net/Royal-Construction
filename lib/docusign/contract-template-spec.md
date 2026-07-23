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
| `paymentSchedule` | `installments_0_installment_item_value` | all stages, compact single field |
| `depositAmount` | `deposit_value` | deposit stage amount |
| `excludedDays` | `days_not_included_value` | "Saturdays, Sundays and NSW Public Holidays" |
| `defectsLiabilityWeeks` | `defects_liability_period_value` | "12 Weeks" |
| `workDescription` | `description_of_the_work_to_be_completed_value` | buildType + buildScope |
| `exclusionsList` | `exclusions_value` | tender exclusion bullets |
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

## Multi-owner / director signers (planned — issues #103, #111, #120; ADR 0003)

Today the contract has **one** customer-side signer role (`Owner`). The offer now
models `owners[]` (individuals + companies with N director signatories), so every
owner is **named** on the contract (`ownerNames` = `formatOwnerNamesLine`, e.g.
"A & B & ABC Pty Ltd (ABN/ACN …)") and each signer is **recorded** on
`EnvelopeSignature` with capacity/entity — but only the **primary** signer signs.
True send-to-all signing is the last piece; this is the design for it.

### The constraint

The BC4 "WHO" block and the `SIGNED BY THE OWNER(S)` area are a **single** region
(confirmed from the MBA form). The MBA webform export uses single-row `_0_`
tokens that reflow (see the Schedule 2 note above), so the blank PDF almost
certainly has **only** `owners_0_*` + one `signed_by_owners_value` anchor — **no**
`owners_1_*` tokens. **First action once the blank PDF is in hand:** confirm with
`pdftotext -layout blank-BC4.pdf - | grep -oE 'owners_[0-9]+_[a-z_]+|signed_by_owners_value|acknowledgement_of_owner_docusign_[0-9]+'`.

### Approach: composite templates + stacked anchor offsets

Because we can't rely on `owners_1_*` tokens, stack signatures by **`anchorYOffset`
on the single `signed_by_owners_value`** rather than per-owner tokens:

- **Base server template** (create-bc4-template.ts) — unchanged in shape: `Builder`
  (routing 2) + `Owner` (routing 1) carrying ALL data tabs + the primary signature
  (anchored on `signed_by_owners_value`, yOffset 0) + the Schedule-1 acknowledgment.
- **For N > 1 signers**, the send builds the envelope with **`compositeTemplates`**:
  the server template + an **inline template** adding signers 2..N as extra
  recipients (routing 1), each a `signHere` **anchored on `signed_by_owners_value`
  with a stacked `anchorYOffset`** (e.g. −8 − k·24 px) so they sit one under
  another in the owner signature area. Composite templates avoid the "unused
  template role → empty-recipient send failure" problem that pre-defining
  `Owner1..OwnerMAX` roles would create.
- **N = 1 stays on the current `templateRoles` path** — fully backward compatible.
- **Bounded max** ~4 owner parties × ~3 directors; beyond that, `log` + block with a
  clear message (never silently drop a signer). Data tabs (ownerNames, ownerAddress
  = primary Current Location, etc.) stay on the primary Owner recipient so the
  customer opens a complete contract (the customer-first invariant, issue #98).

`createContractEnvelope` grows to accept an ordered `owners: {name,email,capacity,
entityName,entityAbn}[]` (it already threads capacity/entity to `EnvelopeSignature`);
`collectOfferSigners(owners)` is the shared ordered list (same one the Tender uses).

### Verification (sandbox — creds already target account-d/demo)

1. Regenerate the template from the blank PDF → new `DOCUSIGN_CONTRACT_TEMPLATE_ID`.
2. Test-send with **1, 2, and 4** signers. Confirm: each signer gets their own
   tracked link + `EnvelopeSignature` row + Connect status; signatures land stacked
   in the OWNER(S) area **without overlap** (calibrate the yOffset step visually,
   like the existing checkbox offsets); the customer still opens a complete
   contract; builder counter-signs last.
3. Re-verify the Connect webhook (envelope-level HMAC) still matches recipients.

**Blocked on:** the blank BC4 PDF (script argument) + a sandbox test-send slot.
