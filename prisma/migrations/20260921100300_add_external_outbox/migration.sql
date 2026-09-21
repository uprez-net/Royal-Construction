CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "OutboxEventKind" AS ENUM (
    'TRADIE_SCHEDULE_REMINDER',
    'TRADIE_SCHEDULE_MANUAL_REMINDER',
    'EMAIL_CAMPAIGN_SEND',
    'INVOICE_STAGE_ISSUE',
    'INVOICE_PDF_ARCHIVE',
    'TEAM_INVITATION_CREATE',
    'TEAM_INVITATION_REVOKE',
    'TEAM_ROLE_RECONCILIATION'
);

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "OutboxEventKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboxEvent_key_key" ON "OutboxEvent"("key");
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE INDEX "OutboxEvent_kind_status_idx" ON "OutboxEvent"("kind", "status");
