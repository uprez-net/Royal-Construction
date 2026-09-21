ALTER TABLE "Lead" ADD COLUMN "estimatedStartDate" TIMESTAMP(3);

CREATE INDEX "Lead_estimatedStartDate_idx" ON "Lead"("estimatedStartDate");
