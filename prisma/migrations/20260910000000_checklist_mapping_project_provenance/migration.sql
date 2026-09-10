-- Provenance for a checklist line answered from a document the project holds
-- rather than from one on the compliance file.
--
-- The HBCF warranty is the only one: cover is raised on the Overview tab, so
-- the certificate is a File with no ComplianceDocument behind it and
-- `mappedFromDocumentId` had nothing to point at. It was left null, which the
-- mapper's own guards read as "somebody filled this in by hand" -- so the line
-- was skipped on every pass after the first, and replacing the certificate on
-- the project left the old copy on the checklist for good.
--
-- Additive and defaulted, so every existing row keeps its current meaning. No
-- backfill: a row already mapped from the project reads as manual until the
-- next replacement, which is what it did before this column existed, and
-- guessing at it would mean deciding from the outside which of two identical
-- states a row is in.
ALTER TABLE "ComplianceDocument"
  ADD COLUMN "mappedFromProject" BOOLEAN NOT NULL DEFAULT false;
