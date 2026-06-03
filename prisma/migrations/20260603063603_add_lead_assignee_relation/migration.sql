-- DropIndex
DROP INDEX "Lead_assigned_idx";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_assignedId_idx" ON "Lead"("assignedId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedId_fkey" FOREIGN KEY ("assignedId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
