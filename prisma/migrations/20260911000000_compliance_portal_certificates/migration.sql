-- The certificate is not issued on the certifier's thread, and the covenant
-- covers two documents rather than one.
--
-- Two corrections that arrive together because they are two ends of the same
-- lodgement. Neither is a new feature on top of the compliance file; both are
-- places where what was built does not match what the job does.
--
-- The first is the bigger one. The file was built believing a certifier passes
-- the last checklist line and then issues the construction certificate, which
-- lands on their email thread like every other document they send. That is not
-- what happens. Passing the checklist is what makes a certifier willing to
-- certify; the certificate itself is applied for on the NSW Planning Portal,
-- and on the complying development path the thing issued is a Complying
-- Development Certificate rather than a construction certificate at all. So
-- there is a lodgement between the checklist and the certificate that the file
-- had nowhere to record, a principal certifier appointment that has to go in
-- with it, and a determination that arrives as an email carrying no document --
-- the portal says it has been approved and tells the applicant to log in and
-- download it. A development consent comes back the same way, which the DA
-- block also did not know.
--
-- The second is the estate developer. Their covenant was read as covering the
-- bushfire assessment, and it covers the full architectural design too -- what
-- it actually protects is the look and the siting of the house as much as its
-- bushfire rating. Two documents approved independently cannot be held in one
-- set of columns, so the verdict becomes a row per document. And the developer
-- themselves could only be named by picking from a checked-in list of estates,
-- which left a job on an estate nobody had added with a covenant it could not
-- record.

-- ---------------------------------------------------------------------------
-- New enum values.
--
-- Every one of these enums is append-only, so each value takes a new slot and
-- no existing row changes meaning. Nothing below *uses* one of them: Postgres
-- will not read a value added in a transaction from inside the same one, and
-- the only DML here writes BUSHFIRE_REPORT, which has existed since the
-- developer approval landed.
-- ---------------------------------------------------------------------------

-- The certificate a complying development job is built under. Its own type
-- beside CONSTRUCTION_CERTIFICATE rather than a reuse of it, because the two
-- paths do not converge on one document -- a CDC carries planning and building
-- approval together, a construction certificate follows a council's consent,
-- and a file holds one or the other.
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'COMPLYING_DEVELOPMENT_CERTIFICATE';

-- The two certificate lodgements. Every field the other five kinds have: a date
-- it went in, a reference to chase it with, a determination, and a document that
-- follows.
ALTER TYPE "ComplianceExternalApplicationKind" ADD VALUE IF NOT EXISTS 'COMPLYING_DEVELOPMENT_CERTIFICATE';
ALTER TYPE "ComplianceExternalApplicationKind" ADD VALUE IF NOT EXISTS 'CONSTRUCTION_CERTIFICATE';

-- The portal has said yes and the document is still not here.
--
-- A kind of alert the file did not have: one raised by good news. Everything
-- else on this enum is a condition that broke an assumption or a wait nobody
-- answered; these three exist because the approval email carries no attachment,
-- which leaves the file approved and holding nothing. They render green and are
-- excluded from the overdue reading of a stage, because nobody is late.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'CDC_DOWNLOAD_READY';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'CC_DOWNLOAD_READY';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'DA_DOWNLOAD_READY';

-- The two certificate waits. One per application rather than a shared type, for
-- the reason every pair on this enum is separate: at most one alert of a type is
-- open per file.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'CDC_DETERMINATION_OVERDUE';
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'CC_DETERMINATION_OVERDUE';

-- The developer sitting on the architectural design, which is a different wait
-- from the same developer sitting on the bushfire report. Both can be open at
-- once, so both need a slot.
ALTER TYPE "ComplianceAlertType" ADD VALUE IF NOT EXISTS 'DEVELOPER_PLANS_OVERDUE';

-- ---------------------------------------------------------------------------
-- New enum types.
--
-- Created rather than extended, so they can be used immediately below.
-- ---------------------------------------------------------------------------

-- Where a file's estate developer details came from, which decides whether to
-- parse the land deed looking for them. A person's answer outranks a parse and
-- stops it for good; the parse does not stop a person correcting it.
--
-- No UNANSWERED member: the absence of a source is unanswered, and a third
-- value meaning the same thing as null is a second way to spell it.
DO $$ BEGIN
  CREATE TYPE "EstateDeveloperSource" AS ENUM ('MANUAL', 'LAND_DEED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- The determination, which is not the document.
--
-- The distinction these two columns exist to hold, and it is not a pedantic
-- one. `receivedAt` is read everywhere as "the wait is over, the document is
-- here or is about to be". What the portal's email establishes is weaker and
-- genuinely different: the application is decided, and the file holds nothing,
-- sometimes for a week. Recording it is what stops the overdue clock without
-- claiming a certificate nobody has downloaded yet.
--
-- The message id is the idempotency guard. A portal that sends the same
-- approval twice -- a resend, a cc, a replayed webhook -- must not re-raise a
-- download alert somebody has already closed by uploading the certificate.
-- Null where an admin recorded the determination by hand, which is the route
-- that has to work: nothing here has been exercised against a live mailbox.
-- ---------------------------------------------------------------------------
ALTER TABLE "ComplianceExternalApplication"
  ADD COLUMN IF NOT EXISTS "approvalNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalNotificationMessageId" TEXT;

-- ---------------------------------------------------------------------------
-- The principal certifier appointment.
--
-- A later fact than engaging a certifier, and a different one. Engaging them is
-- a fee proposal and a checklist; appointing them principal certifier is a form
-- on the portal naming the person who will inspect the build and issue the
-- occupation certificate. A CDC cannot be determined without it -- the
-- application and the appointment go in together -- so it is a gate on the
-- lodgement rather than a note beside it.
--
-- On the engagement rather than on the application, because it is one
-- appointment per job: a job that has to relodge a CDC appoints nobody twice.
-- ---------------------------------------------------------------------------
ALTER TABLE "CertifierEngagement"
  ADD COLUMN IF NOT EXISTS "principalCertifierAppointedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "principalCertifierAppointmentRef" TEXT,
  ADD COLUMN IF NOT EXISTS "principalCertifierAppointedById" TEXT;

-- ---------------------------------------------------------------------------
-- Who the estate developer is.
--
-- `developerApprovalRequired` already answers whether a covenant exists. These
-- answer who it is with, which until now was answerable only by picking an
-- estate out of constants/complianceDevelopers.ts -- a few dozen releases in
-- the growth corridors, against hundreds that exist and new ones every quarter.
-- An estate missing from the list left a job whose answer to "is this land under
-- a developer" was yes, and whose next screen offered nothing to do about it.
--
-- The list stays and is still the fast path; a job answered from it copies its
-- values in here too, so these columns are the single thing every reader
-- consults and ComplianceOutreach.developerKey is only the provenance of a row
-- that was opened from the list.
-- ---------------------------------------------------------------------------
ALTER TABLE "CertifierEngagement"
  ADD COLUMN IF NOT EXISTS "estateDeveloperName" TEXT,
  ADD COLUMN IF NOT EXISTS "estateDeveloperEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "estateDeveloperPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "estateDeveloperSource" "EstateDeveloperSource",
  ADD COLUMN IF NOT EXISTS "estateDeveloperRecordedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estateDeveloperRecordedById" TEXT;

-- SetNull on both, matching ComplianceAlert.resolvedById: the fact outlives the
-- account of whoever recorded it.
DO $$ BEGIN
  ALTER TABLE "CertifierEngagement"
    ADD CONSTRAINT "CertifierEngagement_estateDeveloperRecordedById_fkey"
    FOREIGN KEY ("estateDeveloperRecordedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CertifierEngagement"
    ADD CONSTRAINT "CertifierEngagement_principalCertifierAppointedById_fkey"
    FOREIGN KEY ("principalCertifierAppointedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Backfill: a file that already named a developer off the list.
--
-- Every existing DEVELOPER outreach carries the name and address it was opened
-- with, which is exactly what the three columns above are for. Copying them
-- across means a job mid-approval does not come back from this deploy with an
-- unanswered banner over a developer it has already written to.
--
-- MANUAL as the source, because a person picked the estate. That is the value
-- that stops the land deed parse, which is correct: the answer is already on the
-- file and a parse could only disagree with it.
--
-- Guarded on the name being present and on the engagement not already having
-- one, so the statement is safe to re-run and cannot overwrite anything.
-- ---------------------------------------------------------------------------
UPDATE "CertifierEngagement" e
SET
  "estateDeveloperName" = o."contactName",
  "estateDeveloperEmail" = o."contactEmail",
  "estateDeveloperPhone" = o."contactPhone",
  "estateDeveloperSource" = 'MANUAL',
  "estateDeveloperRecordedAt" = o."createdAt"
FROM "ComplianceOutreach" o
WHERE o."engagementId" = e."id"
  AND o."party" = 'DEVELOPER'
  AND o."contactName" IS NOT NULL
  AND e."estateDeveloperName" IS NULL;

-- ---------------------------------------------------------------------------
-- Who objected to a set of plans.
--
-- The revision table began as the architect's redraw loop, where the client was
-- the only party in it. The developer refusing a bushfire report was the second
-- and collided with nothing, because that round is written against the bushfire
-- consultant's outreach -- a row nobody else writes rounds on.
--
-- The developer refusing the architectural design is what forces the column.
-- That round goes against the architect's outreach, which is the same row the
-- client's own rounds live on -- so without a way to tell them apart a
-- developer's objection read as the client asking for changes, counted towards
-- the rounds the card reports, and was measured by ARCHITECT_REVISION_OVERDUE
-- against a clock that belongs to a different wait.
--
-- Left null on every existing row, which is correct rather than a gap: every
-- round recorded before this is the client's or the bushfire consultant's, and
-- null is what both readers treat as "not the developer".
-- ---------------------------------------------------------------------------
ALTER TABLE "CompliancePlanRevision"
  ADD COLUMN IF NOT EXISTS "requestedBySource" "ComplianceAlertSource";

-- ---------------------------------------------------------------------------
-- One document put to the developer, and what they said about it.
--
-- The five approval* columns on ComplianceOutreach made into rows. They held
-- one verdict, and the covenant covers two documents that are produced by
-- different people at different times and go over in whatever order they are
-- finished -- so the second request overwrote the first answer, and the block
-- showed one decision for whichever document had most recently been sent.
--
-- The old columns are kept rather than dropped. A drop belongs in its own
-- migration behind the deploy that stops reading it, which is the lesson of
-- 20260909000000 dropping PlanningCertificateApplication in the same migration
-- that copied its rows across: migrate deploy runs before the new code, so an
-- instance still serving the old build can query a table that is gone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ComplianceDeveloperApproval" (
  "id" TEXT NOT NULL,
  "outreachId" TEXT NOT NULL,
  "documentType" "ComplianceDocumentType" NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decision" "ComplianceApprovalDecision",
  "decidedAt" TIMESTAMP(3),
  "channel" "ComplianceApprovalChannel",
  "reason" TEXT,
  "round" INTEGER NOT NULL DEFAULT 1,
  "recordedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ComplianceDeveloperApproval_pkey" PRIMARY KEY ("id")
);

-- One row per document per developer. Asking again is the same approval sought
-- a second time -- the verdict clears and `round` bumps -- not a new row, which
-- is what makes "what did they say about the plans" a single lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceDeveloperApproval_outreachId_documentType_key"
  ON "ComplianceDeveloperApproval"("outreachId", "documentType");
CREATE INDEX IF NOT EXISTS "ComplianceDeveloperApproval_outreachId_idx"
  ON "ComplianceDeveloperApproval"("outreachId");

DO $$ BEGIN
  ALTER TABLE "ComplianceDeveloperApproval"
    ADD CONSTRAINT "ComplianceDeveloperApproval_outreachId_fkey"
    FOREIGN KEY ("outreachId") REFERENCES "ComplianceOutreach"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ComplianceDeveloperApproval"
    ADD CONSTRAINT "ComplianceDeveloperApproval_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Backfill: the bushfire verdict every existing developer outreach holds.
--
-- Written for every DEVELOPER row rather than only the decided ones, because
-- the row means "this was put to them" and an outreach that has gone out is
-- exactly that. `requestedAt` is the outreach's own send date where there is
-- one, which is the instant the clock the sweep measures actually started --
-- falling back to the row's creation for a send that never completed.
--
-- BUSHFIRE_REPORT and only it. No existing file has been asked to approve the
-- architectural design, so there is nothing to copy for the second document and
-- inventing a row would claim a request nobody made.
--
-- ON CONFLICT DO NOTHING so a re-run is a no-op rather than a failure.
-- ---------------------------------------------------------------------------
INSERT INTO "ComplianceDeveloperApproval" (
  "id", "outreachId", "documentType", "requestedAt",
  "decision", "decidedAt", "channel", "reason", "round", "recordedById",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  o."id",
  'BUSHFIRE_REPORT',
  COALESCE(o."sentAt", o."createdAt"),
  o."approvalDecision",
  o."approvalDecidedAt",
  o."approvalChannel",
  o."approvalReason",
  1,
  o."approvalDecidedById",
  o."createdAt",
  o."updatedAt"
FROM "ComplianceOutreach" o
WHERE o."party" = 'DEVELOPER'
ON CONFLICT ("outreachId", "documentType") DO NOTHING;
