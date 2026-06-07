/*
  Warnings:

  - You are about to drop the column `quoteId` on the `File` table. All the data in the column will be lost.
  - You are about to drop the `Quote` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuoteItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'PENDING', 'ACCEPTED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_leadId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteItem" DROP CONSTRAINT "QuoteItem_quoteId_fkey";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "quoteId",
ADD COLUMN     "offerId" TEXT;

-- DropTable
DROP TABLE "Quote";

-- DropTable
DROP TABLE "QuoteItem";

-- DropEnum
DROP TYPE "QuoteStatus";

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "leadId" INTEGER NOT NULL,
    "offerStatus" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItem" ADD CONSTRAINT "OfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
