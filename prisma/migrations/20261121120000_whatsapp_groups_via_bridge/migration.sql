-- Project WhatsApp groups move from Meta's Groups API to Royal's WhatsApp
-- bridge (services/whatsapp-bridge). Meta stays for leads.
--
-- Meta's Groups API needed an Official Business Account Royal never had, so
-- no group was ever created through it: at the time of writing the shared
-- staging database holds no ProjectWhatsAppGroup, ProjectWhatsAppMessage or
-- UNLINKED_GROUP rows. The statements below still handle rows if a deployment
-- has them, rather than assume.

-- 1. Groups: drop what only Meta's asynchronous create needed.
DROP INDEX IF EXISTS "ProjectWhatsAppGroup_createRequestId_key";
DROP INDEX IF EXISTS "ProjectWhatsAppGroup_status_requestedAt_idx";

ALTER TABLE "ProjectWhatsAppGroup"
  DROP COLUMN "businessPhoneNumberId",
  DROP COLUMN "businessDisplayNumber",
  DROP COLUMN "createRequestId",
  DROP COLUMN "requestedAt";

-- 2. Group status: SUSPENDED was a Meta state; UNLINKED is new (staff took
-- the group off the project). A Meta group id means nothing to the bridge,
-- so any group from before is kept for its history but no longer live.
UPDATE "ProjectWhatsAppGroup"
  SET "status" = 'DELETED',
      "failureReason" = 'Created through Meta before groups moved to the WhatsApp bridge. Link the project''s group again.'
  WHERE "status" IN ('ACTIVE', 'SUSPENDED', 'CREATING');

ALTER TYPE "ProjectWhatsAppGroupStatus" RENAME TO "ProjectWhatsAppGroupStatus_old";
CREATE TYPE "ProjectWhatsAppGroupStatus" AS ENUM ('CREATING', 'ACTIVE', 'FAILED', 'DELETED', 'UNLINKED');
ALTER TABLE "ProjectWhatsAppGroup"
  ALTER COLUMN "status" TYPE "ProjectWhatsAppGroupStatus"
  USING ("status"::text::"ProjectWhatsAppGroupStatus");
DROP TYPE "ProjectWhatsAppGroupStatus_old";

-- A Meta group id cannot collide with a bridge JID, but release them so the
-- unique key holds only ids the bridge can reach.
UPDATE "ProjectWhatsAppGroup" SET "providerGroupId" = NULL WHERE "status" = 'DELETED';

CREATE INDEX "ProjectWhatsAppGroup_status_idx" ON "ProjectWhatsAppGroup"("status");

-- 3. Unmatched messages: the bridge forwards only groups mapped to a project,
-- so nothing waits as UNLINKED_GROUP any more. Any such rows were posts in
-- Meta groups that were never linked; they are dismissed, not deleted —
-- moved to a reason that still exists so the enum value can go.
UPDATE "WhatsAppUnmatchedMessage"
  SET "status" = 'DISMISSED',
      "reason" = 'NO_MATCH',
      "resolvedAt" = COALESCE("resolvedAt", CURRENT_TIMESTAMP)
  WHERE "reason" = 'UNLINKED_GROUP';

DROP INDEX IF EXISTS "WhatsAppUnmatchedMessage_providerGroupId_status_idx";
ALTER TABLE "WhatsAppUnmatchedMessage" DROP COLUMN "providerGroupId";

ALTER TYPE "WhatsAppUnmatchedReason" RENAME TO "WhatsAppUnmatchedReason_old";
CREATE TYPE "WhatsAppUnmatchedReason" AS ENUM ('NO_MATCH', 'AMBIGUOUS', 'UNKNOWN_BUSINESS_NUMBER');
ALTER TABLE "WhatsAppUnmatchedMessage"
  ALTER COLUMN "reason" TYPE "WhatsAppUnmatchedReason"
  USING ("reason"::text::"WhatsAppUnmatchedReason");
DROP TYPE "WhatsAppUnmatchedReason_old";
