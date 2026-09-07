-- Who raised an alert, widened to include the certifier.
--
-- A certifier can tell us a job needs a DA, and often catches what the
-- architect missed -- but they are not an outreach party, so CompliancePartyType
-- is the wrong type for the field. A CERTIFIER value on ComplianceOutreach.party
-- would be a row nothing in the flow can render or gate on.
--
-- The new enum is a superset, so the column converts through text without a
-- data migration.

-- CreateEnum
CREATE TYPE "ComplianceAlertSource" AS ENUM ('SURVEYOR', 'ARCHITECT', 'COUNCIL', 'CERTIFIER');

-- AlterTable
ALTER TABLE "ComplianceAlert" RENAME COLUMN "raisedByParty" TO "raisedBySource";

ALTER TABLE "ComplianceAlert"
  ALTER COLUMN "raisedBySource" TYPE "ComplianceAlertSource"
  USING "raisedBySource"::text::"ComplianceAlertSource";
