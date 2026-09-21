-- The council's notice of determination, as a document on the file.
--
-- A certifier who has said the job needs development approval cannot assess
-- anything until the consent exists, so the checklist is frozen from the moment
-- that alert is raised until this document lands. It then answers the checklist
-- line asking for it the same way the pack's six do -- which is why it is a
-- document type rather than a date on the application row.
ALTER TYPE "ComplianceDocumentType" ADD VALUE IF NOT EXISTS 'DEVELOPMENT_CONSENT';
