-- CreateEnum
CREATE TYPE "TradieInvoiceInboxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "TradieInvoiceInbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "status" "TradieInvoiceInboxStatus" NOT NULL DEFAULT 'PENDING',
    "graphMessageId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "mailbox" "GraphMailbox" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "issuedDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "subTotal" DECIMAL(12,2),
    "totalTax" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "invoiceId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradieInvoiceInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradieInvoiceInbox_invoiceId_key" ON "TradieInvoiceInbox"("invoiceId");

-- CreateIndex
CREATE INDEX "TradieInvoiceInbox_projectId_status_idx" ON "TradieInvoiceInbox"("projectId", "status");

-- CreateIndex
CREATE INDEX "TradieInvoiceInbox_tradieId_idx" ON "TradieInvoiceInbox"("tradieId");

-- CreateIndex
CREATE UNIQUE INDEX "TradieInvoiceInbox_graphMessageId_attachmentId_key" ON "TradieInvoiceInbox"("graphMessageId", "attachmentId");

-- AddForeignKey
ALTER TABLE "TradieInvoiceInbox" ADD CONSTRAINT "TradieInvoiceInbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoiceInbox" ADD CONSTRAINT "TradieInvoiceInbox_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoiceInbox" ADD CONSTRAINT "TradieInvoiceInbox_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TradieSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoiceInbox" ADD CONSTRAINT "TradieInvoiceInbox_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "TradieInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoiceInbox" ADD CONSTRAINT "TradieInvoiceInbox_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

