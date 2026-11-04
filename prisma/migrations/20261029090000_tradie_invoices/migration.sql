-- CreateEnum
CREATE TYPE "TradieInvoiceSource" AS ENUM ('MANUAL', 'XERO');

-- CreateTable
CREATE TABLE "TradieInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "source" "TradieInvoiceSource" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'AUTHORISED',
    "invoiceNumber" TEXT,
    "reference" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'AUD',
    "subTotal" DECIMAL(12,2) NOT NULL,
    "totalTax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "xeroInvoiceId" TEXT,
    "xeroUpdatedAt" TIMESTAMP(3),
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradieInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradieInvoice_xeroInvoiceId_key" ON "TradieInvoice"("xeroInvoiceId");

-- CreateIndex
CREATE INDEX "TradieInvoice_projectId_idx" ON "TradieInvoice"("projectId");

-- CreateIndex
CREATE INDEX "TradieInvoice_tradieId_idx" ON "TradieInvoice"("tradieId");

-- CreateIndex
CREATE INDEX "TradieInvoice_scheduleId_idx" ON "TradieInvoice"("scheduleId");

-- AddForeignKey
ALTER TABLE "TradieInvoice" ADD CONSTRAINT "TradieInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoice" ADD CONSTRAINT "TradieInvoice_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoice" ADD CONSTRAINT "TradieInvoice_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TradieSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieInvoice" ADD CONSTRAINT "TradieInvoice_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One live invoice per tradie and invoice number. A double-clicked Record,
-- or a bill the office typed in and the bookkeeper then entered in Xero, is
-- the same invoice; counting it twice doubles what the job cost. Voided and
-- deleted invoices are history and do not hold the number. Partial, so
-- Prisma cannot express it in the schema (see the NOTE on TradieInvoice).
CREATE UNIQUE INDEX "TradieInvoice_one_live_number_per_tradie" ON "TradieInvoice"("tradieId", lower("invoiceNumber")) WHERE "invoiceNumber" IS NOT NULL AND "status" NOT IN ('VOIDED', 'DELETED');
