-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED');

-- AlterTable
-- Invoices are raised per ProjectStage, not per milestone. This column carried
-- no FK and no index and was written as NULL on every updateMilestone call, so
-- it never held a value; the Invoice table below replaces it.
ALTER TABLE "Milestone" DROP COLUMN "invoiceId";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "xeroContactId" TEXT;

-- CreateTable
CREATE TABLE "XeroConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scopes" TEXT[],
    "connectedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectStage" "ProjectStage" NOT NULL,
    "xeroInvoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "reference" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'AUTHORISED',
    "currencyCode" TEXT NOT NULL DEFAULT 'AUD',
    "subTotal" DECIMAL(12,2) NOT NULL,
    "totalTax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountCredited" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "fullyPaidOnDate" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "xeroUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_xeroContactId_key" ON "Customer"("xeroContactId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroConnection_tenantId_key" ON "XeroConnection"("tenantId");

-- CreateIndex
CREATE INDEX "XeroConnection_isActive_idx" ON "XeroConnection"("isActive");

-- CreateIndex
CREATE INDEX "XeroConnection_connectedById_idx" ON "XeroConnection"("connectedById");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_xeroInvoiceId_key" ON "Invoice"("xeroInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
-- A stage is claimed exactly once. This is the idempotency guard for invoice
-- generation, which fires from a post-response hook that can run repeatedly.
CREATE UNIQUE INDEX "Invoice_projectId_projectStage_key" ON "Invoice"("projectId", "projectStage");

-- AddForeignKey
ALTER TABLE "XeroConnection" ADD CONSTRAINT "XeroConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
