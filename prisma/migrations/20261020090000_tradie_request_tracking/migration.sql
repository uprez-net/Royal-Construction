-- CreateEnum
CREATE TYPE "TradieRequestDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'RETRYING', 'FAILED');

-- CreateEnum
CREATE TYPE "TradieQuoteSource" AS ENUM ('EMAIL', 'MANUAL');

-- CreateEnum
CREATE TYPE "TradieQuoteGst" AS ENUM ('INCLUSIVE', 'EXCLUSIVE', 'NOT_REGISTERED');

-- CreateEnum
CREATE TYPE "TradeSelectionStatus" AS ENUM ('ACTIVE', 'CANCELLATION_PENDING', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TradieApprovalActionType" ADD VALUE 'TRADE_CANCELLATION';

-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'TRADIE_REQUEST_SEND';

-- AlterTable
ALTER TABLE "TradieSchedule" ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "requestRecipientId" TEXT;

-- CreateTable
CREATE TABLE "TradieRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradieRequestRecipient" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "deliveryStatus" "TradieRequestDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradieRequestRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradieQuote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "source" "TradieQuoteSource" NOT NULL,
    "gstTreatment" "TradieQuoteGst",
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSelection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "tradeKey" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "status" "TradeSelectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "selectedById" TEXT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancellationApprovalId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradieRequest_projectId_idx" ON "TradieRequest"("projectId");

-- CreateIndex
CREATE INDEX "TradieRequestRecipient_tradieId_idx" ON "TradieRequestRecipient"("tradieId");

-- CreateIndex
CREATE INDEX "TradieRequestRecipient_deliveryStatus_nextAttemptAt_idx" ON "TradieRequestRecipient"("deliveryStatus", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradieRequestRecipient_requestId_tradieId_key" ON "TradieRequestRecipient"("requestId", "tradieId");

-- CreateIndex
CREATE INDEX "TradieQuote_projectId_trade_idx" ON "TradieQuote"("projectId", "trade");

-- CreateIndex
CREATE INDEX "TradieQuote_tradieId_idx" ON "TradieQuote"("tradieId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeSelection_cancellationApprovalId_key" ON "TradeSelection"("cancellationApprovalId");

-- CreateIndex
CREATE INDEX "TradeSelection_projectId_tradeKey_status_idx" ON "TradeSelection"("projectId", "tradeKey", "status");

-- CreateIndex
CREATE INDEX "TradeSelection_tradieId_idx" ON "TradeSelection"("tradieId");

-- CreateIndex
CREATE INDEX "TradieSchedule_requestRecipientId_idx" ON "TradieSchedule"("requestRecipientId");

-- CreateIndex
CREATE INDEX "TradieSchedule_quoteId_idx" ON "TradieSchedule"("quoteId");

-- AddForeignKey
ALTER TABLE "TradieSchedule" ADD CONSTRAINT "TradieSchedule_requestRecipientId_fkey" FOREIGN KEY ("requestRecipientId") REFERENCES "TradieRequestRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieSchedule" ADD CONSTRAINT "TradieSchedule_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TradieQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieRequest" ADD CONSTRAINT "TradieRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieRequest" ADD CONSTRAINT "TradieRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieRequestRecipient" ADD CONSTRAINT "TradieRequestRecipient_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TradieRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieRequestRecipient" ADD CONSTRAINT "TradieRequestRecipient_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieQuote" ADD CONSTRAINT "TradieQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieQuote" ADD CONSTRAINT "TradieQuote_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieQuote" ADD CONSTRAINT "TradieQuote_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSelection" ADD CONSTRAINT "TradeSelection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSelection" ADD CONSTRAINT "TradeSelection_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSelection" ADD CONSTRAINT "TradeSelection_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

