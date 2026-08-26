-- A second pass of 20260821030100, for rows written AFTER it ran.
--
-- That migration moved every lead off the retired stages, but it ran at
-- 08:10 on 21 Aug and the deploy that stopped WRITING those stages landed
-- after it. A booking on staging at 08:25 that day put lead #96 straight
-- back onto MEETING_SCHEDULED, where it sat as its own row on the
-- Analytics tab — a stage the picker no longer offers and the team no
-- longer uses. Production had the same window, so it may hold stragglers
-- of its own.
--
-- The current code has no path that writes any of these four, so once
-- this has run they cannot come back. Same clauses as before, same reason
-- updatedAt is left alone, same idempotence.

UPDATE "Lead" SET "stage" = 'DISCOVERY'
WHERE "stage" IN ('IN_FOLLOW_UP', 'MEETING_SCHEDULED');

UPDATE "Lead" SET "stage" = 'CONVERTED' WHERE "stage" = 'WON';

UPDATE "Lead" SET "stage" = 'LOST' WHERE "stage" = 'CANCELLED';
