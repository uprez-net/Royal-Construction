-- Add the estimator-entered BC4 particulars column to Contract (issue #98).
-- Purely additive: a nullable JSONB column, so existing contracts are
-- unaffected (they read back as NULL → the empty particulars set in-app).
-- Captured during CONTRACT_DRAFT and sent as locked DocuSign tabs so the
-- contract can route to the customer first with the builder's fields complete.
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "particulars" JSONB;
