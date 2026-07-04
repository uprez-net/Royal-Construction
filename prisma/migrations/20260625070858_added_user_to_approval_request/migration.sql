/*
  Warnings:

  - Added the required column `requestedBy` to the `TradieApproval` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TradieApproval" ADD COLUMN     "requestedBy" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "TradieApproval_requestedBy_idx" ON "TradieApproval"("requestedBy");

-- AddForeignKey
ALTER TABLE "TradieApproval" ADD CONSTRAINT "TradieApproval_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
