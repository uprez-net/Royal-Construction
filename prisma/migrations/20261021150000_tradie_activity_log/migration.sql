-- CreateTable
CREATE TABLE "TradieActivityLog" (
    "id" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "projectId" TEXT,
    "milestoneId" TEXT,
    "scheduleId" TEXT,
    "authorId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradieActivityLog_tradieId_createdAt_idx" ON "TradieActivityLog"("tradieId", "createdAt");

-- CreateIndex
CREATE INDEX "TradieActivityLog_projectId_idx" ON "TradieActivityLog"("projectId");

-- CreateIndex
CREATE INDEX "TradieActivityLog_scheduleId_idx" ON "TradieActivityLog"("scheduleId");

-- AddForeignKey
ALTER TABLE "TradieActivityLog" ADD CONSTRAINT "TradieActivityLog_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieActivityLog" ADD CONSTRAINT "TradieActivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieActivityLog" ADD CONSTRAINT "TradieActivityLog_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieActivityLog" ADD CONSTRAINT "TradieActivityLog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
