-- Project calls: the project dialer, and inbound calls filed onto a project.
-- Additive only. Calls placed before this have no project and stay on their
-- lead; the matcher only looks back a fortnight, so no backfill is needed.

CREATE TYPE "CallContactKind" AS ENUM ('SITE_MANAGER', 'OWNER', 'TRADIE', 'OTHER');

CREATE TYPE "CallProjectMatch" AS ENUM ('MATCHED', 'NO_MATCH', 'FAILED');

ALTER TYPE "OutboxEventKind" ADD VALUE 'PROJECT_CALL_PLACE';

ALTER TABLE "Call"
  ADD COLUMN "contactKind" "CallContactKind",
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactRef" TEXT,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "projectMatch" "CallProjectMatch",
  ADD COLUMN "projectMatchAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "projectMatchReason" TEXT,
  ADD COLUMN "projectMatchedAt" TIMESTAMP(3),
  ADD COLUMN "projectSeenAt" TIMESTAMP(3);

CREATE INDEX "Call_projectId_startedAt_idx" ON "Call"("projectId", "startedAt");

CREATE INDEX "Call_direction_projectMatch_endedAt_idx" ON "Call"("direction", "projectMatch", "endedAt");

ALTER TABLE "Call" ADD CONSTRAINT "Call_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
