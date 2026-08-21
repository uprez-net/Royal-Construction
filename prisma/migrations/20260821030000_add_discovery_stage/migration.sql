-- Splits "how far has this deal progressed" from "what is scheduled next".
--
-- MEETING_SCHEDULED and IN_FOLLOW_UP were never rungs on the ladder. Any open
-- lead fell into them from a calendar action, and completing a follow-up wrote
-- CONTACTED unconditionally. On production that left 6 of the 11 Contacted
-- leads parked there by the act of doing the work, and not one lead that had
-- ever completed a follow-up sat above Contacted.
--
-- DISCOVERY replaces both as a real stage: collecting the client's
-- requirements. The scheduled work becomes a task, carried by the existing
-- followupDate / meetingDate columns plus the two completion columns here.
--
-- Split across two migrations on purpose. Postgres will not let a new enum
-- value be USED in the transaction that adds it, and Prisma runs each
-- migration file in one. Moving rows to DISCOVERY in this file would fail with
-- "unsafe use of new value of enum type", and a failed migration then blocks
-- every later `prisma migrate deploy` on that database until someone runs
-- `migrate resolve --rolled-back` by hand.
--
-- The old enum members stay. Dropping a Postgres enum value needs a full type
-- swap and any surviving row fails the cast. They become unreachable from the
-- UI in this release; retire them once no rows hold them.

ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'DISCOVERY';

-- Before these existed, the only record that a follow-up had finished was the
-- stage flipping to CONTACTED. That is why a lead in negotiation lost 50 points
-- for having a call rescheduled. The stage no longer moves; these carry it.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "followupCompletedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "meetingCompletedAt"  TIMESTAMP(3);
