-- Staff notes on an activity in the Milestones tab. Internal only.
CREATE TABLE "MilestoneNote" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MilestoneNote_milestoneId_createdAt_idx" ON "MilestoneNote"("milestoneId", "createdAt");

ALTER TABLE "MilestoneNote" ADD CONSTRAINT "MilestoneNote_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MilestoneNote" ADD CONSTRAINT "MilestoneNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
