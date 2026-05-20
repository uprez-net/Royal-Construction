/*
  Warnings:

  - The `type` column on the `Lead` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStage" ADD VALUE 'MEETING_SCHEDULED';
ALTER TYPE "LeadStage" ADD VALUE 'IN_FOLLOW_UP';
ALTER TYPE "LeadStage" ADD VALUE 'NO_RESPONSE';
ALTER TYPE "LeadStage" ADD VALUE 'CONVERTED';
ALTER TYPE "LeadStage" ADD VALUE 'CANCELLED';
ALTER TYPE "LeadStage" ADD VALUE 'DISQUALIFIED';

-- DropIndex
DROP INDEX "Lead_email_key";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lostReason" TEXT,
ALTER COLUMN "phone" SET DEFAULT '',
ALTER COLUMN "email" SET DEFAULT '',
ALTER COLUMN "location" SET DEFAULT '',
ALTER COLUMN "source" DROP NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" TEXT[];

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "budget" DECIMAL(12,2) NOT NULL DEFAULT 10000,
ADD COLUMN     "spend" DECIMAL(12,2);
