-- Record the user's answer to the Development Application question shown on
-- the compliance tab. Null is unanswered; both true and false are answers.
ALTER TABLE "CertifierEngagement"
  ADD COLUMN IF NOT EXISTS "developmentApplicationRequired" BOOLEAN;
