-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('ACTIVE', 'WAITING', 'ARCHIVED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentOperationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentMemoryProvenance" AS ENUM ('USER_CONFIRMED', 'MODEL_SUMMARY');

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "eveSessionId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "parentEveSessionId" TEXT,
    "rootEveSessionId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "selectedContext" JSONB,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastEventAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSessionEvent" (
    "id" TEXT NOT NULL,
    "agentSessionId" TEXT NOT NULL,
    "eveEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActionAudit" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "eveSessionId" TEXT NOT NULL,
    "eveTurnId" TEXT,
    "eveCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "approvalOutcome" TEXT,
    "operationKey" TEXT,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PENDING',
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "beforeSummary" JSONB,
    "afterSummary" JSONB,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentActionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOperation" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "operationKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "AgentOperationStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "provenance" "AgentMemoryProvenance" NOT NULL,
    "lastOperationId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_eveSessionId_key" ON "AgentSession"("eveSessionId");
CREATE INDEX "AgentSession_ownerUserId_updatedAt_idx" ON "AgentSession"("ownerUserId", "updatedAt");
CREATE INDEX "AgentSession_ownerUserId_archivedAt_idx" ON "AgentSession"("ownerUserId", "archivedAt");
CREATE INDEX "AgentSession_ownerUserId_parentEveSessionId_updatedAt_idx" ON "AgentSession"("ownerUserId", "parentEveSessionId", "updatedAt");
CREATE UNIQUE INDEX "AgentSessionEvent_agentSessionId_eveEventId_key" ON "AgentSessionEvent"("agentSessionId", "eveEventId");
CREATE INDEX "AgentSessionEvent_agentSessionId_occurredAt_idx" ON "AgentSessionEvent"("agentSessionId", "occurredAt");
CREATE INDEX "AgentSessionEvent_eventType_occurredAt_idx" ON "AgentSessionEvent"("eventType", "occurredAt");
CREATE INDEX "AgentActionAudit_ownerUserId_createdAt_idx" ON "AgentActionAudit"("ownerUserId", "createdAt");
CREATE INDEX "AgentActionAudit_eveSessionId_createdAt_idx" ON "AgentActionAudit"("eveSessionId", "createdAt");
CREATE INDEX "AgentActionAudit_targetType_targetId_idx" ON "AgentActionAudit"("targetType", "targetId");
CREATE INDEX "AgentActionAudit_operationKey_idx" ON "AgentActionAudit"("operationKey");
CREATE UNIQUE INDEX "AgentOperation_ownerUserId_operationKey_key" ON "AgentOperation"("ownerUserId", "operationKey");
CREATE INDEX "AgentOperation_agentSessionId_createdAt_idx" ON "AgentOperation"("agentSessionId", "createdAt");
CREATE INDEX "AgentOperation_status_updatedAt_idx" ON "AgentOperation"("status", "updatedAt");
CREATE UNIQUE INDEX "AgentMemory_ownerUserId_scope_key" ON "AgentMemory"("ownerUserId", "scope");
CREATE INDEX "AgentMemory_ownerUserId_deletedAt_idx" ON "AgentMemory"("ownerUserId", "deletedAt");
CREATE INDEX "AgentMemory_expiresAt_idx" ON "AgentMemory"("expiresAt");

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSessionEvent" ADD CONSTRAINT "AgentSessionEvent_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentActionAudit" ADD CONSTRAINT "AgentActionAudit_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentActionAudit" ADD CONSTRAINT "AgentActionAudit_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
