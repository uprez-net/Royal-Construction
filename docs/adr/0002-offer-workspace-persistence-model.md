# 2. Offer workspace persistence model

Date: 2026-07-06

## Status

Accepted. Extends ADR 0001 (DocuSign e-signature). Supersedes the earlier CONTEXT note "avoid separate Tender/Contract records in v1".

## Context

The new offer workflow (Job setup → Cost schedule → Pricing → Scope → Offer document → Send & negotiate → Tender → Contract → Project) is fully in-memory (React `useState`). We need to persist it in the existing Postgres/Prisma schema, which already has an `Offer`/`OfferItem`/`OfferFile` set produced by the **legacy AI offer flow** (`lib/workflow/offer.ts`) and read by `projectCreationAgent.ts`. The legacy schema conflicts with the workflow on three points: `Offer` has `@@unique([leadId])` (one offer per lead, but we need revisions), `OfferStatus` has only 4 states, and `OfferItem` is a thin qty×price row. DocuSign integration additionally requires per-document envelope + signature tracking with reminders and legal audit, and the offer document is sent many times during negotiation while tenders/contracts are sent only a few times.

## Decision

**1. Hybrid storage.** `Offer` is the normalized aggregate root. The mutable working-state (build-size facts, cost lines, scope items, payment schedule, pricing settings, offer-document draft) is stored as a structured `workspaceState Json`. An immutable `agreedSnapshot Json` freezes the state at `agreed`. Query-critical fields are promoted to columns (`offerStatus`, `contractValueIncGst`, revision fields, DocuSign refs). A slice is normalized into its own table only when a downstream feature must query it (cost lines → costing report at project creation).

**2. Revisions as rows.** Drop `@@unique([leadId])`. Add `baseReference`, `revisionNumber`, `isActive`, `supersededById` (self-relation) to `Offer`. Enforce one active offer per lead with a **partial unique index** (`WHERE isActive`, added via raw SQL in the migration since Prisma schema can't express a filtered unique) plus app-level guards. Backfill legacy rows to `revisionNumber=1, isActive=true`.

**3. Expand `OfferStatus`** to the full lifecycle: `PENDING, SENT, AGREED, TENDER_DRAFT, TENDER_SENT, TENDER_SIGNED, CONTRACT_DRAFT, CONTRACT_SENT, CONTRACT_SIGNED, PROJECT, REJECTED, SUPERSEDED`. Migrate legacy `ACCEPTED → AGREED` (update rows, then drop `ACCEPTED`). One enum, single source of status truth; UI transition buttons persist the change.

**4. Separate `Tender` and `Contract` tables** (parallel shape), each 1:1 with an `Offer`, holding the generated `documentData Json`, envelope-level DocuSign fields (`envelopeId`, `envelopeStatus`, `sentAt`, `completedAt`, `executedPdfUrl`), and a `version` for the few re-generations/re-sends. They are the legal system of record — not `OfferFile` versions.

**5. Normalized `EnvelopeSignature` table** — one row per signer per document: `documentType (TENDER|CONTRACT)`, `documentId`, `recipientRole (BUILDER|CUSTOMER)`, `name`, `email`, `routingOrder`, `status (CREATED→SENT→DELIVERED→SIGNED / DECLINED)`, `signedAt`, `lastReminderAt`, `reminderCount`, `docusignRecipientId`. Enables signer-level audit and reminders.

**6. Offer document sends** stay on `OfferFile` (versioned `offerContent Json` + `url`, `kind = OFFER_DOCUMENT`) plus an `OfferDocumentSend` log (`offerFileVersion`, `recipientEmail`, `sentAt`, `trackedLinkToken`, `openedAt`) since the offer document is emailed many times with tracked links.

**7. Access pattern.** Prisma + Next **server actions** (matching `lib/data/*`), a new `lib/data/offer-workspace.ts`. Debounced autosave of `workspaceState` while pre-`agreed`; status transitions are explicit actions.

**8. Legacy AI flow coexists.** `lib/workflow/offer.ts` keeps writing `Offer`/`OfferItem`/`OfferFile`; its output seeds the workspace's initial cost schedule. The manual workspace is the primary writer going forward.

**9. Money as integer cents in JSON.** All money inside `workspaceState` is stored as **integer cents** (e.g. `costExGstCents`) and all arithmetic runs in integer cents; dollars are formatted only at the display/PDF boundary. Promoted columns stay `Decimal(12,2)`. Eliminates IEEE float drift when summing cost lines or computing `contractValue × percent` payment stages.

**10. Optimistic concurrency.** `Offer.stateVersion Int` bumps on every save. The client sends the version it loaded; a stale write is rejected (409) and the client reloads. No field-level merge in v1.

**11. Reference minting via a per-year counter table.** `OfferReferenceCounter { year @id, lastSeq }` is incremented in the **same transaction** as the first-revision insert (`SELECT … FOR UPDATE` / atomic upsert). `NNN` is a **global per-year sequence**; revisions reuse `baseReference` and bump `revisionNumber`.

**12. `workspaceState` is zod-validated + versioned.** A zod schema validates on read/write; an internal `schemaVersion` plus a **migrate-on-read** step upgrades older shapes so existing rows keep working after field changes.

**13. Offer audit.** Add `createdById (User)` to `Offer`, and an **`OfferStatusEvent`** log (`offerId`, `fromStatus`, `toStatus`, `actorId`, `at`, `note?`) — one row per transition, complementing `EnvelopeSignature` (signer-level) and the existing `LeadHistory` (lead-level).

**14. Per-send `Envelope` sub-table.** `Tender`/`Contract` (1:1 with Offer, current `documentData` + `version`) → **`Envelope`** (1:many, one per DocuSign send: `envelopeId`, `status`, `sentAt`, `completedAt`, `documentVersion`, `voidedAt`) → **`EnvelopeSignature`** (per signer). Re-generating voids the prior envelope but retains the full record for legal audit and reminder tracking.

### Proposed schema sketch (illustrative, not final)

Money inside `workspaceState`/`documentData` JSON is integer **cents**; `Json` columns also carry a `schemaVersion`.

```prisma
enum OfferStatus {
  PENDING SENT AGREED
  TENDER_DRAFT TENDER_SENT TENDER_SIGNED
  CONTRACT_DRAFT CONTRACT_SENT CONTRACT_SIGNED
  PROJECT REJECTED SUPERSEDED
}
enum EnvelopeDocType { TENDER CONTRACT }
enum EnvelopeStatus  { CREATED SENT DELIVERED COMPLETED VOIDED DECLINED }
enum SignerRole      { BUILDER CUSTOMER }
enum SignerStatus    { CREATED SENT DELIVERED SIGNED DECLINED }

model Offer {
  // ...existing fields...
  offerStatus         OfferStatus @default(PENDING)
  baseReference       String
  revisionNumber      Int      @default(1)
  isActive            Boolean  @default(true)
  supersededById      String?
  supersededBy        Offer?   @relation("OfferRevisions", fields: [supersededById], references: [id])
  revisions           Offer[]  @relation("OfferRevisions")
  createdById         String?
  contractValueIncGst Decimal? @db.Decimal(12,2)
  stateVersion        Int      @default(0)   // optimistic concurrency
  workspaceState      Json?                  // integer cents + schemaVersion
  agreedSnapshot      Json?
  tender              Tender?
  contract            Contract?
  documentSends       OfferDocumentSend[]
  statusEvents        OfferStatusEvent[]
  // drop @@unique([leadId]); add partial unique (leadId) WHERE isActive via raw SQL
}

model Tender {   // Contract mirrors this shape exactly
  id            String     @id @default(uuid())
  offerId       String     @unique
  offer         Offer      @relation(fields: [offerId], references: [id], onDelete: Cascade)
  version       Int        @default(1)
  documentData  Json
  executedPdfUrl String?
  envelopes     Envelope[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
}

model Envelope {              // one per DocuSign send (re-sends retained)
  id             String   @id @default(uuid())
  docType        EnvelopeDocType
  tenderId       String?
  contractId     String?
  docusignId     String?  @unique
  status         EnvelopeStatus @default(CREATED)
  documentVersion Int
  sentAt         DateTime?
  completedAt    DateTime?
  voidedAt       DateTime?
  signatures     EnvelopeSignature[]
  createdAt      DateTime @default(now())
}

model EnvelopeSignature {
  id                  String   @id @default(uuid())
  envelopeId          String
  envelope            Envelope @relation(fields: [envelopeId], references: [id], onDelete: Cascade)
  recipientRole       SignerRole
  name                String
  email               String
  routingOrder        Int
  status              SignerStatus @default(CREATED)
  signedAt            DateTime?
  lastReminderAt      DateTime?
  reminderCount       Int      @default(0)
  docusignRecipientId String?
}

model OfferDocumentSend {
  id               String   @id @default(uuid())
  offerId          String
  offer            Offer    @relation(fields: [offerId], references: [id], onDelete: Cascade)
  offerFileVersion Int
  recipientEmail   String
  trackedLinkToken String   @unique
  sentAt           DateTime @default(now())
  openedAt         DateTime?
}

model OfferStatusEvent {
  id         String      @id @default(uuid())
  offerId    String
  offer      Offer       @relation(fields: [offerId], references: [id], onDelete: Cascade)
  fromStatus OfferStatus?
  toStatus   OfferStatus
  actorId    String?
  note       String?
  at         DateTime    @default(now())
}

model OfferReferenceCounter {
  year    Int @id
  lastSeq Int @default(0)
}
```

## Consequences

- **Migration is non-trivial:** enum expansion (with an `ACCEPTED → AGREED` data step before dropping the value), dropping `@@unique([leadId])` + backfilling `baseReference`/`revisionNumber`/`isActive` + adding a raw-SQL partial unique index, seeding `OfferReferenceCounter` from existing refs, and seven new tables (`Tender`, `Contract`, `Envelope`, `EnvelopeSignature`, `OfferDocumentSend`, `OfferStatusEvent`, `OfferReferenceCounter`).
- **JSON working-state** is not directly queryable; reporting relies on the promoted columns and the tables we normalize deliberately. Its shape must be validated (zod) on read/write since Postgres won't enforce it.
- **Two writers** for `Offer` (legacy AI flow + manual workspace) must not clobber each other; the manual workspace owns `workspaceState`, the AI flow seeds it.
- **DocuSign wiring** (next) fills the envelope/signature fields via the Connect webhook; the normalized `EnvelopeSignature` table makes reminders and legal audit straightforward.
- **Reversible at cost:** promoting a JSON slice to a table later is a standard migration; going the other way (normalized → JSON) is rare and unlikely.
