-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "parentId" TEXT;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
