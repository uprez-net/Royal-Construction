-- Retire the CONVERTED lead stage.
--
-- CONVERTED and WON were identical to every calculation — same probability,
-- same outcome, same banked flag — so this collapses one terminal state that
-- had been split in two. No number changes.
--
-- ORDERING IS THE WHOLE POINT. Postgres has no `ALTER TYPE ... DROP VALUE`, so
-- removing a member means swapping the type, and the USING cast raises 22P02
-- on any row still holding the old value. A failed migration is not merely a
-- failed deploy: Prisma records it in _prisma_migrations with finished_at NULL,
-- and every subsequent `prisma migrate deploy` against that database then fails
-- with P3009 until somebody runs `migrate resolve --rolled-back` by hand. That
-- blocks unrelated deploys, not just this one.
--
-- So the collapse and the swap happen here, in this order, in one migration.
-- Prisma wraps a migration file in a single transaction, which makes them
-- atomic: nothing can write CONVERTED between the UPDATE and the cast, and no
-- maintenance window is needed.

-- 1. Collapse any survivors. Raw SQL, so Prisma's `@updatedAt` is not bumped —
--    the dashboard buckets month-over-month conversion counts by updatedAt, and
--    touching it would drag every historical win into the current month.
--
--    wonAt is stamped where it is missing, and only where it is missing. A
--    CONVERTED lead predates the wonAt column, so collapsing it to WON without
--    a date produces a lead that is won by stage and invisible to the win-rate
--    card — won by every measure except the one that counts. updatedAt is the
--    same approximation scripts/backfill-lead-close-dates.ts already uses for
--    exactly this case, and CLOSE_DATE_TRACKING_START keeps the UI honest that
--    dates this old are estimated. now() would be worse than useless: it would
--    drop every historical win into the current 90-day window.
UPDATE "Lead"
SET "stage" = 'WON',
    "wonAt" = COALESCE("wonAt", "updatedAt")
WHERE "stage" = 'CONVERTED';

-- 2. Swap the type. Lead.stage is the only column using LeadStage; its default
--    must be dropped first because the old default cannot be cast to the new
--    type, and Lead_stage_idx is rebuilt automatically by the table rewrite.
ALTER TYPE "LeadStage" RENAME TO "LeadStage_old";

CREATE TYPE "LeadStage" AS ENUM (
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'QUOTED',
  'NEGOTIATING',
  'WON',
  'LOST',
  'MEETING_SCHEDULED',
  'IN_FOLLOW_UP',
  'NO_RESPONSE',
  'CANCELLED',
  'DISQUALIFIED'
);

ALTER TABLE "Lead" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "stage" TYPE "LeadStage" USING ("stage"::text::"LeadStage");
ALTER TABLE "Lead" ALTER COLUMN "stage" SET DEFAULT 'NEW';

DROP TYPE "LeadStage_old";
