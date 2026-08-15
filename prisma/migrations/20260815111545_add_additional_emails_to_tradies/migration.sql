/*
  Warnings:

  - You are about to drop the column `hourlyRate` on the `Tradie` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tradie" DROP COLUMN "hourlyRate",
ADD COLUMN     "additionalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastQuotedPrice" DECIMAL(8,2);
