-- Moves the rows that sat on the two retired stages, plus the two stages we
-- already agreed are duplicates nothing can tell apart.
--
-- Runs after 20260821030000 because Postgres will not let a new enum value be
-- used in the transaction that adds it.
--
-- Deliberately keeps followupDate and meetingDate untouched. The Follow-ups tab
-- now keys off those dates rather than the stage, so every lead with real
-- scheduled work keeps it and simply shows its true stage alongside.
--
-- On production this moved 10 IN_FOLLOW_UP, 1 MEETING_SCHEDULED, 4 WON and 2
-- CANCELLED. Only 4 of the 10 carried a follow-up date; the other 6 were
-- already invisible in the tab, because every bucket there requires one. This
-- does not lose them, it surfaces them: six leads in Discovery with nothing
-- scheduled, which is a list someone can work through.
--
-- Idempotent: each clause matches only the stage it moves, so a re-run is a
-- no-op. updatedAt is Prisma's @updatedAt, a client feature rather than a
-- database trigger, so raw SQL leaves it alone and does not drag historical
-- rows into the current month on the dashboard's month-over-month counts.

UPDATE "Lead" SET "stage" = 'DISCOVERY'
WHERE "stage" IN ('IN_FOLLOW_UP', 'MEETING_SCHEDULED');

-- WON and CONVERTED are the same outcome and only CONVERTED is selectable.
-- wonAt is left as it is: these rows keep whatever close date they had.
UPDATE "Lead" SET "stage" = 'CONVERTED' WHERE "stage" = 'WON';

-- CANCELLED has been unreachable from the UI for some time and is
-- indistinguishable from LOST in every calculation.
UPDATE "Lead" SET "stage" = 'LOST' WHERE "stage" = 'CANCELLED';
