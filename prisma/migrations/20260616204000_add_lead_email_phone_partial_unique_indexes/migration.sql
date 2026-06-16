-- Existing production lead data contains duplicate non-empty emails/phones, so
-- these indexes are lookup indexes only. createLead serializes duplicate checks
-- with transaction-scoped advisory locks instead of relying on UNIQUE indexes.
CREATE INDEX IF NOT EXISTS "Lead_email_non_empty_idx"
  ON "Lead" ("email")
  WHERE "email" <> '';

CREATE INDEX IF NOT EXISTS "Lead_phone_non_empty_idx"
  ON "Lead" ("phone")
  WHERE "phone" <> '';
