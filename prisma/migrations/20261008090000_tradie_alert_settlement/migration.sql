-- A dismissed tradie alert is remembered against the status it was dismissed
-- at, so it stays hidden until the booking moves on.
ALTER TABLE "TradieSchedule" ADD COLUMN "alertDismissedStatus" "TradieScheduleStatus";
ALTER TABLE "TradieSchedule" ADD COLUMN "alertDismissedAt" TIMESTAMP(3);

-- Settling a milestone now settles the bookings on it
-- (`lib/domain/tradies/settlement.ts`). Apply the same rule to milestones that
-- were finished before it existed, whose bookings were left open and alerting.

-- 1. Close the approvals waiting on bookings this is about to settle.
UPDATE "TradieApproval" a
SET "status" = 'REJECTED',
    "pendingDeletionKey" = NULL,
    "rejectionReason" = 'The milestone was already settled, so this booking was settled with it.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE a."status" = 'PENDING'
  AND a."actionType" IN ('SCHEDULE_APPROVAL', 'SCHEDULE_DELETION')
  AND COALESCE(a."pendingDeletionKey", a."updationData"->>'scheduleId') IN (
    SELECT s."id"
    FROM "TradieSchedule" s
    JOIN "Milestone" m ON m."id" = s."milestoneId"
    WHERE m."status" IN ('DONE', 'NOT_REQUIRED')
      AND s."status" NOT IN ('DECLINED', 'COMPLETED', 'CANCELLED')
  );

-- 2. Approved bookings on a finished milestone did the work.
UPDATE "TradieSchedule" s
SET "status" = 'COMPLETED', "updatedAt" = CURRENT_TIMESTAMP
FROM "Milestone" m
WHERE m."id" = s."milestoneId"
  AND m."status" = 'DONE'
  AND s."status" IN ('CONFIRMED', 'PENDING_FINAL_CONFIRMATION');

-- 3. Everything else still open on a settled milestone never will.
UPDATE "TradieSchedule" s
SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
FROM "Milestone" m
WHERE m."id" = s."milestoneId"
  AND m."status" IN ('DONE', 'NOT_REQUIRED')
  AND s."status" NOT IN ('DECLINED', 'COMPLETED', 'CANCELLED');
