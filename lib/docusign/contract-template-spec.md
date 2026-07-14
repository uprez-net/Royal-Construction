# DocuSign Contract Template Spec — MBA BC4 (March 2025, NSW)

The building Contract is the MBA-copyrighted "Residential Building (BC4)"
standard form, so it is NOT generated at runtime like the Tender. Instead a
DocuSign **template** is created once from the blank BC4 PDF, and
`sendContractForSignature` (lib/data/offer-contract-sign.ts) creates envelopes
from it, injecting values from the signed Tender by **tab label**.

Set the template's ID in `DOCUSIGN_CONTRACT_TEMPLATE_ID`.

## How to create the template

1. DocuSign → Templates → New → upload the **blank** BC4 PDF.
2. Add two recipient roles, in this signing order:
   - Role name `Builder` — routing order 1 (signs first, acting as the final
     review gate for any particulars left blank).
   - Role name `Owner` — routing order 2 (the primary/authorised signatory;
     the BC4 form carries a single owner signature block).
3. Place the signature fields:
   - Agreement page ("IT IS AGREED THAT"): Owner **Sign Here** + Builder
     **Sign Here** on their respective lines; **Date Signed** next to the
     day/month/year line for whichever role should stamp it.
   - Schedule 1 owner acknowledgment page: Owner **Sign Here**, **Date
     Signed**, plus the `ownerPrintName` / `ownerCapacity` text tabs below.
4. Add **Text** fields with EXACTLY the tab labels below. Assign each one to
   the **Builder** role (values render before the Owner signs). Leave
   "required" off for the optional ones.
5. Builder identity (name, address, licence 383992C, ABN, bank account) is
   constant — type it into the template document itself, not as tabs.
6. Schedule 1 checklist boxes: pre-tick the 17 "Yes" boxes in the template.

The code fills known values as **locked** tabs; anything it cannot derive is
sent **unlocked and empty** so the Builder completes it during their signing
session.

## Tab labels

| Tab label | Page | Filled from | Notes |
|---|---|---|---|
| `contractPrice` | i (price warning) | tender contract sum | "$1,367,500.00" format |
| `ownerNames` | ii WHO | job.clientNames | |
| `ownerAddress` | ii WHO | — (unlocked) | postal address not captured yet |
| `ownerPhone` | ii WHO | — (unlocked) | |
| `ownerMobile` | ii WHO | — (unlocked) | |
| `ownerEmail` | ii WHO | job.clientEmail / send input | |
| `siteAddress` | ii WHERE | job.siteAddress | |
| `contractPriceFinance` | ii FINANCE | tender contract sum | same value as `contractPrice` |
| `hbcfCost` | ii FINANCE | — (unlocked) | HBCF premium |
| `variationPercent` | Sch 2 item 1 | constant "10%" | editable before send in code |
| `paymentStage1`…`paymentStage7` | Sch 2 item 4(a) | payment schedule stage labels | e.g. "(2) Slab 15%" |
| `paymentAmount1`…`paymentAmount7` | Sch 2 item 4(a) | stage % × contract sum | blank rows stay empty |
| `contractPriceSchedule` | Sch 2 item 4(a) | tender contract sum | |
| `depositAmount` | Sch 2 item 4(b) | deposit stage amount | |
| `paymentDays` | Sch 2 item 4(d) | — (unlocked) | blank ⇒ 5 days per form |
| `interestRate` | Sch 2 item 4(e) | — (unlocked) | blank ⇒ 15% p.a. per form |
| `commencementDate` | Sch 2 item 5(a) | — (unlocked) | |
| `constructionDays` | Sch 2 item 5(b) | — (unlocked) | |
| `excludedDays` | Sch 2 item 5(c) | constant | "Saturdays, Sundays and NSW Public Holidays" |
| `demolitionMaterials` | Sch 2 item 6 | — (unlocked) | |
| `defectsLiabilityWeeks` | Sch 2 item 7 | constant "12 Weeks" | |
| `preContractCosts` | Sch 2 item 9 | — (unlocked) | |
| `workDescription` | Sch 3 (a) | job.buildType + buildScope | |
| `exclusionsList` | Sch 3 (b) | tender exclusion bullets | multiline |
| `specialConditions` | Sch 4 | — (unlocked) | |
| `ownerPrintName` | Sch 1 ack (Owner role) | first owner name | assign to **Owner** role |
| `ownerCapacity` | Sch 1 ack (Owner role) | — (unlocked) | e.g. "Director"; assign to **Owner** role |

Checkbox tabs (assign to Builder role):

| Tab label | Page | Filled from |
|---|---|---|
| `gstInclusive` | ii FINANCE | checked (price is inc GST) |
| `hbcfIncluded` | ii FINANCE | checked |
| `exclusionsYes` | Sch 3 (b) | checked when exclusions exist |
