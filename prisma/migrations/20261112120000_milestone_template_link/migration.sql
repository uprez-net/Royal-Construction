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

-- Link the activities already on projects -- only those provably seeded from
-- the build sequence. A matching name is not proof: an activity added by hand
-- on a project (createMilestone) can carry the same name and stage as a
-- build-sequence row and was never created from it.
--
-- The provenance signal is when the row was written. createMilestonesFromTemplate
-- runs in the same command as the project's own insert, so a seeded activity is
-- created with the project; one added by hand comes later, in a request of its
-- own. Only rows created within two minutes of their project are linked, and
-- only where name and stage name exactly one build-sequence row. Anything else
-- stays unlinked and keeps its own duration rather than borrowing a guessed one.
UPDATE "Milestone" AS m
   SET "templateId" = t."id"
  FROM "MilestoneTemplate" AS t, "Project" AS p
 WHERE m."templateId" IS NULL
   AND p."id" = m."projectId"
   AND m."createdAt" >= p."createdAt"
   AND m."createdAt" <= p."createdAt" + INTERVAL '2 minutes'
   AND m."name" = t."name"
   AND m."projectStage" = t."projectStage"
   AND (
     SELECT COUNT(*) FROM "MilestoneTemplate" AS other
      WHERE other."name" = t."name"
        AND other."projectStage" = t."projectStage"
   ) = 1;
