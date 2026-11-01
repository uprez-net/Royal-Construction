-- CreateEnum
CREATE TYPE "VariationKind" AS ENUM ('CHARGEABLE', 'PROMOTIONAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxEventKind" ADD VALUE 'VARIATION_INVOICE_ISSUE';
ALTER TYPE "OutboxEventKind" ADD VALUE 'VARIATION_EMAIL_SEND';

-- AlterTable
ALTER TABLE "Variation" ADD COLUMN     "documentUrl" TEXT,
ADD COLUMN     "invoiceAmountPaid" DECIMAL(12,2),
ADD COLUMN     "invoiceStatus" "InvoiceStatus",
ADD COLUMN     "invoiceTax" DECIMAL(12,2),
ADD COLUMN     "invoiceTotal" DECIMAL(12,2),
ADD COLUMN     "issueError" TEXT,
ADD COLUMN     "kind" "VariationKind" NOT NULL DEFAULT 'CHARGEABLE',
ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "newPrice" DECIMAL(12,2),
ADD COLUMN     "number" INTEGER,
ADD COLUMN     "previousPrice" DECIMAL(12,2),
ADD COLUMN     "raisedById" TEXT,
ADD COLUMN     "requestKey" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "xeroInvoiceId" TEXT,
ADD COLUMN     "xeroInvoiceNumber" TEXT,
ADD COLUMN     "xeroUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TradieInvoice" ADD COLUMN     "documentName" TEXT,
ADD COLUMN     "documentUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Variation_requestKey_key" ON "Variation"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Variation_xeroInvoiceId_key" ON "Variation"("xeroInvoiceId");

-- CreateIndex
CREATE INDEX "Variation_milestoneId_idx" ON "Variation"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Variation_projectId_number_key" ON "Variation"("projectId", "number");

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: number every existing variation in the order it was raised, so
-- the log's V-001, V-002 stay what the office has been reading.
UPDATE "Variation" AS v
SET "number" = ranked.n
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "projectId"
           ORDER BY "requestedDate" ASC, "createdAt" ASC, "id" ASC
         ) AS n
  FROM "Variation"
) AS ranked
WHERE v."id" = ranked."id";
