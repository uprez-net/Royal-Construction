-- Existing compliance rows and message ids belong to the business mailbox.
-- New compliance rows are explicitly stamped ADMIN by the application.
CREATE TYPE "GraphMailbox" AS ENUM ('BUSINESS', 'ADMIN');

ALTER TABLE "CertifierEngagement"
  ADD COLUMN "graphMailbox" "GraphMailbox" NOT NULL DEFAULT 'BUSINESS';

ALTER TABLE "ComplianceOutreach"
  ADD COLUMN "graphMailbox" "GraphMailbox" NOT NULL DEFAULT 'BUSINESS';

ALTER TABLE "CertifierEmail"
  ADD COLUMN "graphMailbox" "GraphMailbox" NOT NULL DEFAULT 'BUSINESS';
