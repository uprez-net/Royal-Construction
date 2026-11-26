-- Post-call handoffs, tightened after review
-- (lib/domain/comms/calls/owner-call-handoff.ts). Additive.

-- Every delivery attempt claims the handoff under its own id, so a stale
-- attempt cannot write over the current one; the revision tells Hermes a
-- reopened handoff from the same delivery sent twice.
ALTER TABLE "OwnerCallHandoff" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OwnerCallHandoff" ADD COLUMN "claimId" TEXT;

-- Owner calls made before handoffs existed never get one from the backstop:
-- existing rows are marked ineligible, and every new call is eligible.
ALTER TABLE "OwnerCall" ADD COLUMN "handoffEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OwnerCall" ALTER COLUMN "handoffEligible" SET DEFAULT true;
