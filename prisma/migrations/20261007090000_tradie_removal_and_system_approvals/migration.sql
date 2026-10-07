-- Preserve tradies and bookings when an administrator approves removal.
ALTER TABLE "Tradie" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Tradie_archivedAt_idx" ON "Tradie"("archivedAt");
ALTER TYPE "TradieScheduleStatus" ADD VALUE 'CANCELLED';

-- Inbound Graph replies have a trusted channel, not a signed-in staff user.
ALTER TABLE "TradieApproval" ALTER COLUMN "requestedBy" DROP NOT NULL;
ALTER TABLE "TradieApproval" ADD COLUMN "requestSource" TEXT;

-- The old non-transactional transition could change the status before failing
-- to create its approval. Recover those stranded bookings without approving them.
INSERT INTO "TradieApproval" (
  "id", "tradieId", "actionType", "status", "reason", "updationData",
  "requestedBy", "requestSource", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, s."tradieId", 'SCHEDULE_APPROVAL', 'PENDING',
  'Recovered booking awaiting admin approval after an inbound reply. Please review before approving.',
  jsonb_build_object(
    'scheduleId', s."id", 'projectId', p."id", 'projectName', p."name",
    'milestoneId', s."milestoneId", 'milestoneName', COALESCE(m."name", 'General Task'),
    'scheduledDate', s."scheduledDate", 'durationDays', s."durationDays",
    'cost', '$' || to_char(COALESCE(
      CASE WHEN s."quotedPrice" ~ '^[0-9]+([.][0-9]+)?$' THEN s."quotedPrice"::numeric END,
      CASE WHEN t."lastQuotedPriceUnit" = 'FIXED' THEN t."lastQuotedPrice"
        ELSE t."lastQuotedPrice" * s."durationDays" * 8 END, 0), 'FM999999999990.00')
  ),
  NULL, 'graph:tradie-email-reply (recovered)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TradieSchedule" s
JOIN "Tradie" t ON t."id" = s."tradieId"
JOIN "Project" p ON p."id" = s."projectId"
LEFT JOIN "Milestone" m ON m."id" = s."milestoneId"
WHERE s."status" = 'AWAITING_ADMIN_APPROVAL'
  AND NOT EXISTS (
    SELECT 1 FROM "TradieApproval" a
    WHERE a."actionType" = 'SCHEDULE_APPROVAL' AND a."status" = 'PENDING'
      AND a."tradieId" = s."tradieId" AND a."updationData"->>'scheduleId' = s."id"
  );
