-- The CDC pipeline's missing clocks and gates.
--
-- Everything here exists because the compliance flow had steps nobody could
-- see the state of. A planning certificate was either on the file or it was
-- not, with no record that an application had been lodged three days earlier;
-- a client/architect meeting happened entirely off-system; a round of client
-- revisions left no trace between the phone call and the plans arriving. Each
-- of those is a wait, and a wait nobody records is a wait nobody can chase.

-- ---------------------------------------------------------------------------
-- New enum values.
--
-- Every one of these enums is append-only, so each value takes a new slot and
-- no existing row changes meaning.
-- ---------------------------------------------------------------------------

-- The two consultant deliverables a certifier's checklist routinely calls for.
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'BASIX_CERTIFICATE';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'BUSHFIRE_REPORT';

-- The consultants themselves, as outreach parties and as alert sources.
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'BASIX_CONSULTANT';
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'BUSHFIRE_CONSULTANT';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'BASIX_CONSULTANT';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'BUSHFIRE_CONSULTANT';

-- The overdue conditions, one per party rather than one shared type: at most
-- one alert of a type is open per file, so a shared type would let a job
-- waiting on both the surveyor and a consultant say only one of those out loud.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'PLANNING_CERTIFICATE_DELAYED';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'SURVEYOR_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'ARCHITECT_PLANS_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'ARCHITECT_REVISION_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'BASIX_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'BUSHFIRE_RESPONSE_OVERDUE';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ComplianceMeetingStatus" AS ENUM ('SCHEDULED', 'HELD', 'RESCHEDULED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- ComplianceOutreach gains the clocks.
--
-- sentAt is backfilled from the first outbound message on each thread rather
-- than from updatedAt: that column moves whenever anything touches the row, so
-- an SLA measured from it would reset itself every time somebody replied.
-- Rows with no outbound mail stay null, which is the truth about them -- a
-- SELF_SUPPLIED row is waiting on nobody, and a send that never completed has
-- not started any clock.
-- ---------------------------------------------------------------------------

ALTER TABLE "ComplianceOutreach"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "lastFollowUpAt" TIMESTAMP(3),
  ADD COLUMN "clientPlansApprovedAt" TIMESTAMP(3),
  ADD COLUMN "checklistDocumentId" TEXT;

UPDATE "ComplianceOutreach" AS o
SET "sentAt" = first_send."sentAt"
FROM (
  SELECT "outreachId", MIN("sentAt") AS "sentAt"
  FROM "CertifierEmail"
  WHERE "outreachId" IS NOT NULL AND "direction" = 'OUTBOUND'
  GROUP BY "outreachId"
) AS first_send
WHERE o."id" = first_send."outreachId";

CREATE INDEX "ComplianceOutreach_checklistDocumentId_idx"
  ON "ComplianceOutreach"("checklistDocumentId");

ALTER TABLE "ComplianceOutreach"
  ADD CONSTRAINT "ComplianceOutreach_checklistDocumentId_fkey"
  FOREIGN KEY ("checklistDocumentId") REFERENCES "ComplianceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: ComplianceMeeting
-- ---------------------------------------------------------------------------

CREATE TABLE "ComplianceMeeting" (
    "id" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ComplianceMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "heldAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceMeeting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceMeeting_outreachId_idx" ON "ComplianceMeeting"("outreachId");
CREATE INDEX "ComplianceMeeting_outreachId_status_idx" ON "ComplianceMeeting"("outreachId", "status");

ALTER TABLE "ComplianceMeeting"
  ADD CONSTRAINT "ComplianceMeeting_outreachId_fkey"
  FOREIGN KEY ("outreachId") REFERENCES "ComplianceOutreach"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: CompliancePlanRevision
-- ---------------------------------------------------------------------------

CREATE TABLE "CompliancePlanRevision" (
    "id" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompliancePlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompliancePlanRevision_outreachId_idx" ON "CompliancePlanRevision"("outreachId");
CREATE INDEX "CompliancePlanRevision_outreachId_respondedAt_idx" ON "CompliancePlanRevision"("outreachId", "respondedAt");

ALTER TABLE "CompliancePlanRevision"
  ADD CONSTRAINT "CompliancePlanRevision_outreachId_fkey"
  FOREIGN KEY ("outreachId") REFERENCES "ComplianceOutreach"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: PlanningCertificateApplication
--
-- Backfilled for engagements that already hold a certificate, so a file part
-- way through the flow does not re-ask a question it has visibly answered.
-- alreadyHeld is true for those: we cannot know whether it was bought or
-- already on hand, and "already held" is the reading that asks for nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE "PlanningCertificateApplication" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "alreadyHeld" BOOLEAN,
    "appliedAt" TIMESTAMP(3),
    "applicationRef" TEXT,
    "lodgedWith" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningCertificateApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanningCertificateApplication_engagementId_key"
  ON "PlanningCertificateApplication"("engagementId");

ALTER TABLE "PlanningCertificateApplication"
  ADD CONSTRAINT "PlanningCertificateApplication_engagementId_fkey"
  FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PlanningCertificateApplication" ("id", "engagementId", "alreadyHeld", "receivedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."engagementId",
  TRUE,
  MIN(f."createdAt"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ComplianceDocument" d
JOIN "File" f ON f."complianceDocumentId" = d."id"
WHERE d."documentType" = 'PLANNING_CERTIFICATE_10_7'
GROUP BY d."engagementId"
ON CONFLICT ("engagementId") DO NOTHING;
