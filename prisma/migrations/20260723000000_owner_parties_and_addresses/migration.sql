-- Owner parties + addresses (ADR 0003; issues #109/#110/#111/#120/#103).
-- Purely additive, all columns nullable, so existing rows are unaffected.
--
-- The owner party model (owners[], Current + Site Location, company/directors)
-- lives inside Offer.workspaceState JSON and is migrated on read (schemaVersion
-- 1 -> 2). These columns cover the relational touch-points:
--   * Customer.address    — primary owner's Current Location, set at handoff.
--   * Project.parties      — full owner set preserved on the Project.
--   * EnvelopeSignature.*  — per-signer signing capacity + represented company.

-- Primary owner's Current Location (residential/postal), promoted to Customer
-- at project handoff.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "address" TEXT;

-- Full owner party set (individuals + companies + directors, both addresses,
-- per-owner contact) carried over from the offer at handoff.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "parties" JSONB;

-- Per-signer signing capacity ("Owner"/"Director") + the company a director
-- signs on behalf of. recipientRole stays BUILDER|CUSTOMER.
ALTER TABLE "EnvelopeSignature" ADD COLUMN IF NOT EXISTS "capacity" TEXT;
ALTER TABLE "EnvelopeSignature" ADD COLUMN IF NOT EXISTS "entityName" TEXT;
ALTER TABLE "EnvelopeSignature" ADD COLUMN IF NOT EXISTS "entityAbn" TEXT;
