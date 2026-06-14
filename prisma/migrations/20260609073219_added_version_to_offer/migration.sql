/*
  Warnings:

  - You are about to drop the column `offerId` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `OfferItem` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[leadId]` on the table `Offer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `item` to the `OfferItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_offerId_fkey";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "offerId";

-- AlterTable
ALTER TABLE "OfferItem" DROP COLUMN "updatedAt",
ADD COLUMN     "item" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OfferFile" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "filename" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filesize" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offerContent" JSONB NOT NULL,

    CONSTRAINT "OfferFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferFile_offerId_idx" ON "OfferFile"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferFile_offerId_version_key" ON "OfferFile"("offerId", "version");

-- CreateIndex
CREATE INDEX "Offer_leadId_idx" ON "Offer"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_leadId_key" ON "Offer"("leadId");

-- CreateIndex
CREATE INDEX "OfferItem_offerId_idx" ON "OfferItem"("offerId");

-- AddForeignKey
ALTER TABLE "OfferFile" ADD CONSTRAINT "OfferFile_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
