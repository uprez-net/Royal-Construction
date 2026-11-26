-- What an owner call leaves for Hermes once it ends
-- (lib/domain/comms/calls/owner-call-handoff.ts): one handoff per owner call,
-- the requests the owner made on it, and the callback Hermes scheduled from
-- it. Additive: a new enum, two new tables and a nullable column.

-- CreateEnum
CREATE TYPE "OwnerCallHandoffStatus" AS ENUM ('OPEN', 'PENDING', 'DELIVERING', 'DELIVERED', 'RESOLVED', 'FAILED');

-- AlterTable
ALTER TABLE "OwnerCall" ADD COLUMN "fromHandoffId" TEXT;

-- CreateTable
CREATE TABLE "OwnerCallHandoff" (
    "id" TEXT NOT NULL,
    "ownerCallId" TEXT NOT NULL,
    "status" "OwnerCallHandoffStatus" NOT NULL DEFAULT 'OPEN',
    "readyAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "hermesReply" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerCallHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerCallHandoffRequest" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "callBack" BOOLEAN NOT NULL,
    "timing" TEXT,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerCallHandoffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerCall_fromHandoffId_key" ON "OwnerCall"("fromHandoffId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerCallHandoff_ownerCallId_key" ON "OwnerCallHandoff"("ownerCallId");

-- CreateIndex
CREATE INDEX "OwnerCallHandoff_status_updatedAt_idx" ON "OwnerCallHandoff"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerCallHandoffRequest_handoffId_dedupeKey_key" ON "OwnerCallHandoffRequest"("handoffId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OwnerCallHandoffRequest_handoffId_createdAt_idx" ON "OwnerCallHandoffRequest"("handoffId", "createdAt");

-- AddForeignKey
ALTER TABLE "OwnerCall" ADD CONSTRAINT "OwnerCall_fromHandoffId_fkey" FOREIGN KEY ("fromHandoffId") REFERENCES "OwnerCallHandoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerCallHandoff" ADD CONSTRAINT "OwnerCallHandoff_ownerCallId_fkey" FOREIGN KEY ("ownerCallId") REFERENCES "OwnerCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerCallHandoffRequest" ADD CONSTRAINT "OwnerCallHandoffRequest_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "OwnerCallHandoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
