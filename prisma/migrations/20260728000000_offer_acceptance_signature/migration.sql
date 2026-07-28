-- Offer-document acceptance signing via DocuSign (ADR 0004).
--
-- Additive only: new enum members, a nullable Envelope.offerId parent link so an
-- OFFER-type acceptance envelope can hang directly off the Offer (no Tender/
-- Contract row), and Offer.executedPdfUrl for the archived executed acceptance
-- PDF (parallels Tender/Contract.executedPdfUrl). Nothing existing is altered, so
-- this runs cleanly under `prisma migrate deploy`. Postgres 12+ permits
-- ALTER TYPE ... ADD VALUE inside the migration transaction because the new
-- values are not USED in this migration.

-- New Offer lifecycle states for the customer-only acceptance gate.
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'OFFER_SENT';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'OFFER_SIGNED';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'OFFER_DECLINED';

-- Envelope doc type for an Offer-acceptance envelope.
ALTER TYPE "EnvelopeDocType" ADD VALUE IF NOT EXISTS 'OFFER';

-- The archived executed acceptance PDF.
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "executedPdfUrl" TEXT;

-- An OFFER envelope hangs directly off the Offer.
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "offerId" TEXT;

CREATE INDEX IF NOT EXISTS "Envelope_offerId_idx" ON "Envelope"("offerId");

-- FK guarded for idempotency (Postgres has no IF NOT EXISTS on ADD CONSTRAINT).
-- ON DELETE CASCADE mirrors the tenderId/contractId parent links.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Envelope_offerId_fkey'
  ) THEN
    ALTER TABLE "Envelope"
      ADD CONSTRAINT "Envelope_offerId_fkey"
      FOREIGN KEY ("offerId") REFERENCES "Offer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
