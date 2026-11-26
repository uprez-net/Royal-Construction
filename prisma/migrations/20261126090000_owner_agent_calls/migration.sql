-- Mili ringing the owner line for Hermes (lib/domain/comms/calls/owner-call.ts),
-- now or at a scheduled time, and the log of what the call desk did on any
-- call Mili takes. Additive: new enum values, the owner line (one row at most),
-- the owner-call requests and their events.

-- CreateEnum
CREATE TYPE "OwnerCallStatus" AS ENUM ('SCHEDULED', 'PLACING', 'PLACED', 'CANCELED', 'FAILED');

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'OWNER_CALL_PLACE';

-- AlterEnum
ALTER TYPE "CallStaffTarget" ADD VALUE 'AGENT';

-- CreateTable
CREATE TABLE "CommsOwnerLine" (
    "id" TEXT NOT NULL DEFAULT 'owner',
    "nickname" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsOwnerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerCall" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OwnerCallStatus" NOT NULL DEFAULT 'SCHEDULED',
    "callAt" TIMESTAMP(3) NOT NULL,
    "placedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "failureReason" TEXT,
    "callId" TEXT,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "agenda" TEXT[],
    "context" TEXT NOT NULL,
    "reference" TEXT,
    "eventAt" TIMESTAMP(3),
    "questionsAsked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCallEvent" (
    "id" TEXT NOT NULL,
    "callId" TEXT,
    "ownerCallId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerCall_idempotencyKey_key" ON "OwnerCall"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerCall_callId_key" ON "OwnerCall"("callId");

-- CreateIndex
CREATE INDEX "OwnerCall_status_callAt_idx" ON "OwnerCall"("status", "callAt");

-- CreateIndex
CREATE INDEX "OwnerCall_createdAt_idx" ON "OwnerCall"("createdAt");

-- CreateIndex
CREATE INDEX "AgentCallEvent_callId_occurredAt_idx" ON "AgentCallEvent"("callId", "occurredAt");

-- CreateIndex
CREATE INDEX "AgentCallEvent_ownerCallId_occurredAt_idx" ON "AgentCallEvent"("ownerCallId", "occurredAt");

-- AddForeignKey
ALTER TABLE "OwnerCall" ADD CONSTRAINT "OwnerCall_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCallEvent" ADD CONSTRAINT "AgentCallEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCallEvent" ADD CONSTRAINT "AgentCallEvent_ownerCallId_fkey" FOREIGN KEY ("ownerCallId") REFERENCES "OwnerCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

