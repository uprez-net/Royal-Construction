-- Developer sign-off on the bushfire report, and the rest of the way through a
-- development application.
--
-- Three things that arrive together because they are three points on one path.
--
-- The first is the estate developer. Land released by a developer routinely
-- carries a covenant that their own consultant approves the bushfire assessment
-- before it is lodged anywhere. The report is commissioned from the bushfire
-- consultant exactly as it already is; what is new is that it then has to go to
-- the developer and come back approved, and that a rejection sends it back to
-- the consultant with the developer's own words attached. That is an outreach,
-- a thread and a clock -- all of which already exist -- plus a verdict, which
-- does not.
--
-- The second is what the council asks for after a development application is
-- lodged. The DA list is a fixed set of types, so a request for a shadow
-- diagram or a survey of a neighbouring wall had nowhere to go, and a
-- resubmission overwrote the only date the file held.
--
-- The third is the end of the file: the construction certificate the certifier
-- issues once every checklist line has passed, and the HBCF cover that follows
-- it.

-- ---------------------------------------------------------------------------
-- New enum values.
--
-- Every one of these enums is append-only, so each value takes a new slot and
-- no existing row changes meaning. Nothing in this migration *uses* one of
-- these values -- Postgres will not allow a value added in a transaction to be
-- read in the same one -- which is why the Project.status default moves in the
-- migration after this.
-- ---------------------------------------------------------------------------

-- What the council asks for after lodgement, and what the certifier issues at
-- the end.
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'DA_ITEM';
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'CONSTRUCTION_CERTIFICATE';

-- The estate developer, as an outreach party and as a source of alerts and
-- rejections.
ALTER TYPE "CompliancePartyType" ADD VALUE IF NOT EXISTS 'DEVELOPER';
ALTER TYPE "ComplianceAlertSource" ADD VALUE IF NOT EXISTS 'DEVELOPER';

-- Two clocks on the same party, deliberately not one. At most one alert of a
-- type is open per file, so a job waiting on a developer's first answer and a
-- job waiting on a consultant to redo what that developer rejected have to be
-- able to say so separately.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'DEVELOPER_RESPONSE_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'BUSHFIRE_REVISION_OVERDUE';

-- The two stages after the checklist passes. APPROVED already means every line
-- is ticked; these are the certificate the certifier then issues, and the file
-- being finished once the HBCF cover is on it too.
ALTER TYPE "CertifierEngagementStatus" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';
ALTER TYPE "CertifierEngagementStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- The project ladder. DRAFT is where a project is created from now on;
-- COMPLIANCE_STARTED is the certifier being engaged; COMPLIANCE_COMPLETED is
-- the construction certificate and the HBCF cover both being on the file, with
-- nothing yet started on site.
--
-- Existing rows are untouched and stay ACTIVE, which is correct: every project
-- already in the system is one somebody is actually working on.
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'COMPLIANCE_STARTED';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'COMPLIANCE_COMPLETED';

-- ---------------------------------------------------------------------------
-- New enum types.
--
-- Created rather than extended, so they can be used immediately below.
-- ---------------------------------------------------------------------------

-- A verdict from a party asked to approve somebody else's work. The developer
-- is the only one: everybody else on a compliance file is asked to produce a
-- document, and the document being there is the answer.
DO $$ BEGIN
  CREATE TYPE "ComplianceApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- How the verdict reached us. A model reading it off a reply, or a person who
-- read the same reply and pressed the button.
DO $$ BEGIN
  CREATE TYPE "ComplianceApprovalChannel" AS ENUM ('INBOUND_EMAIL', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- The developer's verdict, on the outreach that sought it.
--
-- Columns on ComplianceOutreach rather than a table of their own, following
-- clientPlansApprovedAt and wasteManagementRequestedAt: they are facts about
-- one party's engagement, at most one of them is live at a time, and the rounds
-- that precede a final answer are recorded as CompliancePlanRevision rows.
--
-- Null on every existing row and on every non-DEVELOPER row for good.
-- ---------------------------------------------------------------------------
ALTER TABLE "ComplianceOutreach"
  ADD COLUMN IF NOT EXISTS "developerKey" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalDecision" "ComplianceApprovalDecision",
  ADD COLUMN IF NOT EXISTS "approvalDecidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalChannel" "ComplianceApprovalChannel",
  ADD COLUMN IF NOT EXISTS "approvalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalDecidedById" TEXT;

-- SetNull rather than Cascade, matching ComplianceAlert.resolvedById: a
-- decision outlives the account of whoever recorded it.
DO $$ BEGIN
  ALTER TABLE "ComplianceOutreach"
    ADD CONSTRAINT "ComplianceOutreach_approvalDecidedById_fkey"
    FOREIGN KEY ("approvalDecidedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Whether the lot needs a developer's approval at all.
--
-- Null means nobody has been asked, which is what holds the development
-- application shut on a job that needs a bushfire report. It is a column rather
-- than an alert because the answer is needed while it is still false: "no
-- approval needed on this estate" is an answer the gate has to read, and a
-- resolved alert would be indistinguishable from one nobody ever raised.
-- ---------------------------------------------------------------------------
ALTER TABLE "CertifierEngagement"
  ADD COLUMN IF NOT EXISTS "developerApprovalRequired" BOOLEAN;

-- ---------------------------------------------------------------------------
-- Who sent a document row back.
--
-- The reason alone was enough while the certifier was the only body that
-- rejected anything, and the row said so in as many words. A council rejects
-- individual drawings by name on a development application, and "Sent back by
-- the certifier" on a council's objection is wrong in the one place a reader
-- relies on it.
--
-- Left null on the rejections already recorded, which are all the certifier's
-- by definition -- the UI falls back to that reading rather than backfilling a
-- guess.
-- ---------------------------------------------------------------------------
ALTER TABLE "ComplianceDocument"
  ADD COLUMN IF NOT EXISTS "rejectedBySource" "ComplianceAlertSource";

-- ---------------------------------------------------------------------------
-- Every round an application was lodged in.
--
-- ComplianceExternalApplication.appliedAt records that an application exists
-- and when its clock started. It cannot record that it was sent back and lodged
-- again, and a development application routinely is: the council asks for a
-- shadow diagram and rejects two drawings, the builder revises them off-system
-- and resubmits, and that is round two of an application that may run to four.
--
-- The clock reads the latest round rather than the first, which is the whole
-- reason this is a table: a DA resubmitted in April is not sixty working days
-- late because it was first lodged in March.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ComplianceApplicationSubmission" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "applicationRef" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ComplianceApplicationSubmission_pkey" PRIMARY KEY ("id")
);

-- One row per round. A double-submitted form is the same round reported twice,
-- not a second lodgement.
CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceApplicationSubmission_applicationId_round_key"
  ON "ComplianceApplicationSubmission"("applicationId", "round");
CREATE INDEX IF NOT EXISTS "ComplianceApplicationSubmission_applicationId_idx"
  ON "ComplianceApplicationSubmission"("applicationId");
-- The sweep and the block both want the newest round and nothing else.
CREATE INDEX IF NOT EXISTS "ComplianceApplicationSubmission_applicationId_submittedAt_idx"
  ON "ComplianceApplicationSubmission"("applicationId", "submittedAt" DESC);

DO $$ BEGIN
  ALTER TABLE "ComplianceApplicationSubmission"
    ADD CONSTRAINT "ComplianceApplicationSubmission_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "ComplianceExternalApplication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Round one for every application already lodged.
--
-- Without this an existing DA has a lodgement date and no rounds, and the clock
-- -- which reads the latest round -- would treat it as never submitted. The
-- backfill is exactly what the table would have recorded had it existed when
-- the application was lodged.
-- ---------------------------------------------------------------------------
INSERT INTO "ComplianceApplicationSubmission" ("id", "applicationId", "round", "submittedAt", "applicationRef", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::TEXT,
  a."id",
  1,
  a."appliedAt",
  a."applicationRef",
  a."createdAt",
  a."updatedAt"
FROM "ComplianceExternalApplication" a
WHERE a."appliedAt" IS NOT NULL
ON CONFLICT ("applicationId", "round") DO NOTHING;
