/*
  Warnings:

  - A unique constraint covering the columns `[MicrosoftmessageId]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "MicrosoftmessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_MicrosoftmessageId_key" ON "Lead"("MicrosoftmessageId");
