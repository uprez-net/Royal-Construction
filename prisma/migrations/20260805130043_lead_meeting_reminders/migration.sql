-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "followupReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "meetingDate" TIMESTAMP(3),
ADD COLUMN     "meetingMode" TEXT,
ADD COLUMN     "meetingReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "meetingTime" TEXT;

-- AlterTable
ALTER TABLE "LeadHistory" ADD COLUMN     "authorId" TEXT;

-- CreateIndex
CREATE INDEX "LeadHistory_authorId_idx" ON "LeadHistory"("authorId");

-- AddForeignKey
ALTER TABLE "LeadHistory" ADD CONSTRAINT "LeadHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
