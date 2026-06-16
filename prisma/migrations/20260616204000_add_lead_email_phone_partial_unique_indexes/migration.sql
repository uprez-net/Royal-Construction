CREATE UNIQUE INDEX IF NOT EXISTS "Lead_email_non_empty_key"
  ON "Lead" ("email")
  WHERE "email" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_phone_non_empty_key"
  ON "Lead" ("phone")
  WHERE "phone" <> '';
