-- Tradie email threads: every email between the office and a tradie about a
-- project, in both directions, so the Tradies tab can show the conversation
-- and reply on it. Request emails stay on TradieRequestRecipient.

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'TRADIE_THREAD_REPLY_SEND';

-- CreateTable
CREATE TABLE "TradieEmail" (
    "id" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "projectId" TEXT,
    "scheduleId" TEXT,
    "direction" "CommsDirection" NOT NULL,
    "emailFrom" TEXT,
    "emailTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refToken" TEXT,
    "graphMessageId" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradieEmail_graphMessageId_tradieId_key" ON "TradieEmail"("graphMessageId", "tradieId");

-- CreateIndex
CREATE INDEX "TradieEmail_projectId_tradieId_sentAt_idx" ON "TradieEmail"("projectId", "tradieId", "sentAt");

-- CreateIndex
CREATE INDEX "TradieEmail_tradieId_sentAt_idx" ON "TradieEmail"("tradieId", "sentAt");

-- CreateIndex
CREATE INDEX "TradieEmail_scheduleId_idx" ON "TradieEmail"("scheduleId");

-- AddForeignKey
ALTER TABLE "TradieEmail" ADD CONSTRAINT "TradieEmail_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieEmail" ADD CONSTRAINT "TradieEmail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieEmail" ADD CONSTRAINT "TradieEmail_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TradieSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
