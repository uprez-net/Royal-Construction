-- CreateEnum
CREATE TYPE "LeadValueSource" AS ENUM ('OFFER', 'MANUAL');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "estimatedValue" DECIMAL(14,2),
ADD COLUMN     "estimatedValueSource" "LeadValueSource",
ADD COLUMN     "expectedCloseDate" TIMESTAMP(3),
ADD COLUMN     "lostAt" TIMESTAMP(3),
ADD COLUMN     "probabilityOverride" INTEGER,
ADD COLUMN     "wonAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Lead_expectedCloseDate_idx" ON "Lead"("expectedCloseDate");

-- CreateIndex
CREATE INDEX "Lead_wonAt_idx" ON "Lead"("wonAt");

-- CreateIndex
CREATE INDEX "Lead_lostAt_idx" ON "Lead"("lostAt");
