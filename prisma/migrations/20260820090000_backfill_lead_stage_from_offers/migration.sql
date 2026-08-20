-- One-time data correction: mark leads won whose offers already reached
-- CONTRACT_SIGNED or PROJECT before the lead-stage sync existed.
--
-- The modern offer lifecycle never wrote Lead.stage, so every deal signed
-- before that sync shipped has a lead sitting wherever a human last dragged it.
-- On staging that was four signed-or-building deals and not one lead at WON,
-- including a live project worth $945,000 whose lead read "Meeting Scheduled".
-- Win rate had no wins to count and open pipeline counted work already built.
--
-- This runs as a migration rather than a hand-run script on purpose. Migrations
-- already execute automatically against both databases via `prisma migrate
-- deploy` in the deploy jobs, in order, recorded in _prisma_migrations and
-- visible in the deploy log. A script only ever runs if somebody remembers to
-- run it, from a laptop holding a production credential.
--
-- Idempotent: the stage filter excludes anything already won, so a re-run
-- matches nothing. scripts/backfill-lead-stage-from-offers.ts remains as a
-- read-only dry run for seeing what this will change before it ships.
--
-- Raw SQL deliberately: `updatedAt` is Prisma's `@updatedAt`, a client feature
-- rather than a database trigger, so this does not disturb it. The dashboard
-- buckets month-over-month conversion counts by updatedAt, and bumping it would
-- drag every historical win into the current month.

WITH signed AS (
  SELECT
    o."leadId",
    -- The real signing moment, not today. Using now() would dump every
    -- historical win into the current 90-day window, spike the win-rate card
    -- on deploy day and cliff it 90 days later. Offers with no recorded event
    -- fall back to the offer's own updatedAt, an upper bound.
    COALESCE(
      (
        SELECT MIN(e."at")
        FROM "OfferStatusEvent" e
        WHERE e."offerId" = o."id"
          AND e."toStatus" IN ('CONTRACT_SIGNED', 'PROJECT')
      ),
      o."updatedAt"
    ) AS won_at
  FROM "Offer" o
  WHERE o."isActive" = TRUE
    AND o."offerStatus" IN ('CONTRACT_SIGNED', 'PROJECT')
),
earliest AS (
  -- A lead can carry more than one signed offer over time; the first win is
  -- the one the win-rate window should see.
  SELECT "leadId", MIN(won_at) AS won_at
  FROM signed
  GROUP BY "leadId"
)
UPDATE "Lead" l
SET "stage" = 'WON',
    "wonAt" = e.won_at,
    "lostAt" = NULL
FROM earliest e
WHERE l."id" = e."leadId"
  -- Already won: nothing to do, and re-dating an existing win would be wrong.
  -- Closed as lost: a human recorded that with a reason. A signed offer on a
  -- lost lead is a contradiction for a person to resolve, not for a migration
  -- to overwrite silently.
  AND l."stage" NOT IN ('WON', 'CONVERTED', 'LOST', 'CANCELLED', 'DISQUALIFIED');
