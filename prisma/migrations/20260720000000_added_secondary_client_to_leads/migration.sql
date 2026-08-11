-- Add nullable secondary client columns to the Lead table.
-- These columns mirror the style of the existing name/phone/email columns but
-- are nullable and carry no default, so the migration is purely additive and
-- incurs no data loss. The primary name/phone/email columns are untouched.

ALTER TABLE "Lead" ADD COLUMN "secondaryName"  TEXT;
ALTER TABLE "Lead" ADD COLUMN "secondaryEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN "secondaryPhone" TEXT;