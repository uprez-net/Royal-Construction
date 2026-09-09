-- Mapping what the file already holds, and the development application path.
--
-- Two halves that share a schema for the same reason they share a screen. The
-- first is that a certifier's checklist asks for six things the required pack
-- already collected -- the deposited plan, the title search, the survey, the
-- full architectural set, the 10.7 certificate, the HBCF warranty -- and an
-- admin was re-uploading each of them against a row sitting inches below the
-- row that already had it. The second is that everything the checklist asks
-- for beyond those, a development application asks for too: the same
-- structural drawings, the same water approvals, the same levy receipt.
--
-- So the types, the parties and the applications below are added once and read
-- by both paths.

-- ---------------------------------------------------------------------------
-- New enum values.
--
-- Every one of these enums is append-only, so each value takes a new slot and
-- no existing row changes meaning.
-- ---------------------------------------------------------------------------

-- What a checklist line, or a development application, asks for beyond the
-- pack. Three from the structural engineer, two from the water servicing
-- coordinator, three bought from portals, one each from the architect and a
-- traffic consultant, and two the builder and the owners produce themselves.
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'STRUCTURAL_DRAWINGS';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'HYDRAULIC_STORMWATER_DRAWINGS';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'GEOTECH_REPORT';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'WATER_SERVICING_APPROVAL';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'SECTION_73_NOTICE';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'ROAD_OPENING_PERMIT';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'LONG_SERVICE_LEVY';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'MINE_SUBSIDENCE_APPROVAL';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'WASTE_MANAGEMENT_PLAN';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'TRAFFIC_CONTROL_PLAN';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'BUILD_COST_SUMMARY';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'OWNER_CONSENT_FORM';

-- The three new parties, as outreach parties and as alert sources.
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'STRUCTURAL_ENGINEER';
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'WATER_AUTHORITY';
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'TRAFFIC_CONSULTANT';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'STRUCTURAL_ENGINEER';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'WATER_AUTHORITY';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'TRAFFIC_CONSULTANT';

-- One overdue condition per party and per application, never a shared type
-- carrying which: at most one alert of a type is open per file, so a job
-- waiting on the structural engineer and the road opening permit at once would
-- otherwise be able to say only one of those out loud.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'STRUCTURAL_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'WATER_AUTHORITY_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'TRAFFIC_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'WASTE_MANAGEMENT_PLAN_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'ROAD_OPENING_DELAYED';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'LONG_SERVICE_LEVY_DELAYED';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'MINE_SUBSIDENCE_DELAYED';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'DA_DETERMINATION_OVERDUE';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ComplianceExternalApplicationKind" AS ENUM (
    'PLANNING_CERTIFICATE_10_7',
    'ROAD_OPENING',
    'LONG_SERVICE_LEVY',
    'MINE_SUBSIDENCE',
    'DEVELOPMENT_APPLICATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- CreateTable: ComplianceExternalApplication, replacing
-- PlanningCertificateApplication.
--
-- Same five fields, keyed by kind. The 10.7 rows move across unchanged and the
-- old table goes, rather than the two living side by side: they are one
-- concept, and two tables would mean two components, two routes and two sweeps
-- describing the same "lodged on Monday, still nothing back" wait.
--
-- The move preserves each row's id, so anything holding an application id --
-- an audit entry, an open tab -- still resolves.
-- ---------------------------------------------------------------------------

CREATE TABLE "ComplianceExternalApplication" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" "ComplianceExternalApplicationKind" NOT NULL,
    "alreadyHeld" BOOLEAN,
    "appliedAt" TIMESTAMP(3),
    "applicationRef" TEXT,
    "lodgedWith" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceExternalApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplianceExternalApplication_engagementId_kind_key"
  ON "ComplianceExternalApplication"("engagementId", "kind");
CREATE INDEX "ComplianceExternalApplication_engagementId_idx"
  ON "ComplianceExternalApplication"("engagementId");

ALTER TABLE "ComplianceExternalApplication"
  ADD CONSTRAINT "ComplianceExternalApplication_engagementId_fkey"
  FOREIGN KEY ("engagementId") REFERENCES "CertifierEngagement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ComplianceExternalApplication" (
  "id", "engagementId", "kind", "alreadyHeld",
  "appliedAt", "applicationRef", "lodgedWith", "receivedAt",
  "createdAt", "updatedAt"
)
SELECT
  p."id",
  p."engagementId",
  'PLANNING_CERTIFICATE_10_7',
  p."alreadyHeld",
  p."appliedAt",
  p."applicationRef",
  p."lodgedWith",
  p."receivedAt",
  p."createdAt",
  p."updatedAt"
FROM "PlanningCertificateApplication" p
ON CONFLICT ("engagementId", "kind") DO NOTHING;

DROP TABLE "PlanningCertificateApplication";

-- ---------------------------------------------------------------------------
-- CreateTable: ComplianceOutreachDeliverable.
--
-- The one-to-one assumption under ComplianceOutreach.checklistDocumentId
-- stopped being true. A BASIX consultant is engaged against item 7 and sends
-- back one certificate; a structural engineer is engaged once and answers
-- three separate lines. One column can only name one of them.
--
-- Every existing row is backfilled, so a consultant engaged before this and
-- replying after it still has their reply filed against the line that asked.
-- ---------------------------------------------------------------------------

CREATE TABLE "ComplianceOutreachDeliverable" (
    "id" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "documentType" "ComplianceDocumentType" NOT NULL,
    "checklistDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceOutreachDeliverable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplianceOutreachDeliverable_outreachId_documentType_key"
  ON "ComplianceOutreachDeliverable"("outreachId", "documentType");
CREATE INDEX "ComplianceOutreachDeliverable_outreachId_idx"
  ON "ComplianceOutreachDeliverable"("outreachId");
CREATE INDEX "ComplianceOutreachDeliverable_checklistDocumentId_idx"
  ON "ComplianceOutreachDeliverable"("checklistDocumentId");

ALTER TABLE "ComplianceOutreachDeliverable"
  ADD CONSTRAINT "ComplianceOutreachDeliverable_outreachId_fkey"
  FOREIGN KEY ("outreachId") REFERENCES "ComplianceOutreach"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceOutreachDeliverable"
  ADD CONSTRAINT "ComplianceOutreachDeliverable_checklistDocumentId_fkey"
  FOREIGN KEY ("checklistDocumentId") REFERENCES "ComplianceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ComplianceOutreachDeliverable" (
  "id", "outreachId", "documentType", "checklistDocumentId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  CASE o."party"
    WHEN 'BASIX_CONSULTANT' THEN 'BASIX_CERTIFICATE'::"ComplianceDocumentType"
    WHEN 'BUSHFIRE_CONSULTANT' THEN 'BUSHFIRE_REPORT'::"ComplianceDocumentType"
  END,
  o."checklistDocumentId",
  o."createdAt",
  CURRENT_TIMESTAMP
FROM "ComplianceOutreach" o
WHERE o."party" IN ('BASIX_CONSULTANT', 'BUSHFIRE_CONSULTANT')
ON CONFLICT ("outreachId", "documentType") DO NOTHING;

-- ---------------------------------------------------------------------------
-- The waste management plan's own clock.
--
-- On the architect's row, and separate from their other three, because the
-- plan is asked for long after the drawings -- off a checklist line or off the
-- development application -- and an overdue measured from the outreach that
-- engaged them months earlier would fire on the day it was requested.
-- ---------------------------------------------------------------------------

ALTER TABLE "ComplianceOutreach"
  ADD COLUMN "wasteManagementRequestedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Where a checklist line's document was taken from.
--
-- The file itself is copied rather than moved -- a File belongs to exactly one
-- ComplianceDocument, so the checklist line gets its own File row pointing at
-- the same blob, and every count, send and replacement path keeps working
-- unchanged on a mapped row. This column is the provenance that copy would
-- otherwise lose, and what stops a re-extraction mapping the same document
-- onto the same line twice.
--
-- SET NULL rather than CASCADE: the copy is the checklist's own from the
-- moment it is made, and must outlive the pack row it came from.
-- ---------------------------------------------------------------------------

ALTER TABLE "ComplianceDocument"
  ADD COLUMN "mappedFromDocumentId" TEXT;

CREATE INDEX "ComplianceDocument_mappedFromDocumentId_idx"
  ON "ComplianceDocument"("mappedFromDocumentId");

ALTER TABLE "ComplianceDocument"
  ADD CONSTRAINT "ComplianceDocument_mappedFromDocumentId_fkey"
  FOREIGN KEY ("mappedFromDocumentId") REFERENCES "ComplianceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
