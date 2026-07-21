-- Add the customer-declined lifecycle states to OfferStatus (issue #89).
-- Purely additive: two new enum members, no existing rows or values touched.
-- Postgres 12+ permits ALTER TYPE ... ADD VALUE inside a transaction, so these
-- run cleanly under `prisma migrate deploy`.
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'TENDER_DECLINED';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'CONTRACT_DECLINED';
