-- Issue #422: activity durations are configured on the build sequence and
-- follow onto every project activity that is not yet complete.

-- New activities default to two calendar days. Existing rows keep whatever
-- duration they already hold: an admin may have set it on purpose.
ALTER TABLE "MilestoneTemplate" ALTER COLUMN "estimatedDays" SET DEFAULT 2;
ALTER TABLE "Milestone" ALTER COLUMN "estimatedDays" SET DEFAULT 2;

-- Which build-sequence row each project activity came from.
ALTER TABLE "Milestone" ADD COLUMN "templateId" TEXT;

CREATE INDEX "Milestone_templateId_idx" ON "Milestone"("templateId");

ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MilestoneTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link the activities already on projects. Activities were copied from the
-- build sequence by name and stage, so that is the match -- but only where it
-- is unambiguous. A name used twice in one stage links nothing, and those
-- activities keep their own duration rather than borrowing a guessed one.
UPDATE "Milestone" AS m
   SET "templateId" = t."id"
  FROM "MilestoneTemplate" AS t
 WHERE m."templateId" IS NULL
   AND m."name" = t."name"
   AND m."projectStage" = t."projectStage"
   AND (
     SELECT COUNT(*) FROM "MilestoneTemplate" AS other
      WHERE other."name" = t."name"
        AND other."projectStage" = t."projectStage"
   ) = 1;
