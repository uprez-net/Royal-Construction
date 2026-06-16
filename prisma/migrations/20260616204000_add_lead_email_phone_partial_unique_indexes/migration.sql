CREATE INDEX IF NOT EXISTS "Lead_email_non_empty_idx"
  ON "Lead" ("email")
  WHERE "email" <> '';

CREATE INDEX IF NOT EXISTS "Lead_phone_non_empty_idx"
  ON "Lead" ("phone")
  WHERE "phone" <> '';
