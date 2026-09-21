-- Preserve sanitised agent provenance when a user is removed.
ALTER TABLE "AgentActionAudit" DROP CONSTRAINT "AgentActionAudit_ownerUserId_fkey";
ALTER TABLE "AgentActionAudit" ALTER COLUMN "ownerUserId" DROP NOT NULL;
ALTER TABLE "AgentActionAudit" ADD CONSTRAINT "AgentActionAudit_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One live deletion request may exist for a schedule at a time. The key is
-- cleared when the approval is resolved, allowing a later request.
ALTER TABLE "TradieApproval" ADD COLUMN "pendingDeletionKey" TEXT;
CREATE UNIQUE INDEX "TradieApproval_pendingDeletionKey_key"
  ON "TradieApproval"("pendingDeletionKey");
