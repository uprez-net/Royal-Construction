-- Admin Offer Content: application-wide singleton row holding the reusable
-- boilerplate content pre-filled onto every new construction offer
-- (build scope, cost schedule workbook, offer scope allowances/exclusions,
-- offer document inclusions + default T&Cs). The four content sections are
-- stored as Json so their nested shapes can evolve without a migration.
--
-- Additive only (new table), so this runs cleanly under `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS "AdminOfferContent" (
  "id" TEXT NOT NULL,
  "buildScope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "costSchedule" JSONB NOT NULL,
  "offerScope" JSONB NOT NULL,
  "offerContent" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminOfferContent_pkey" PRIMARY KEY ("id")
);
