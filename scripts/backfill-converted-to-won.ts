// One-time backfill: rewrite every Lead still holding stage=CONVERTED to WON.
//
// CONVERTED and WON were always identical to the pipeline maths — same
// probability, same outcome, same banked flag — so this collapses a split
// terminal state, it does not change any number.
//
// Run this before the phase B migration so the enum drop has nothing left to
// choke on. Postgres has no `ALTER TYPE ... DROP VALUE`, so dropping CONVERTED
// is a type swap whose `USING ("stage"::text::"LeadStage_new")` cast raises
// 22P02 on any surviving CONVERTED row. That aborts the migration AND leaves it
// half-recorded in _prisma_migrations, after which EVERY `prisma migrate
// deploy` on that database fails with P3009 until someone manually runs
// `prisma migrate resolve --rolled-back` — blocking unrelated deploys, not just
// this one.
//
// The zero-remaining check below is a point-in-time read, NOT a guarantee: it
// cannot stop a write landing between this script finishing and the migration
// running. So the phase B migration must ALSO perform the same UPDATE inside
// its own transaction, immediately before the type swap. That makes the two
// steps atomic and removes the need for a maintenance window. This script
// exists to move the bulk of the data (and to record what moved) while nothing
// is under time pressure, not to be the only safety net.
//
// Run: pnpm backfill:converted-to-won
//
// Idempotent: only touches rows still holding CONVERTED, so a re-run reports 0.
//
// $executeRaw, deliberately, NOT prisma.lead.updateMany. `updatedAt` is
// declared `@updatedAt`, which is a Prisma-client feature rather than a
// database trigger, so updateMany would stamp every rewritten row with now().
// lib/data/dashboard.ts buckets converted leads by updatedAt for its
// month-over-month cards, so that would drag every historical win into the
// current month and empty the previous one. Raw SQL bypasses the client's
// updatedAt handling and leaves the column alone.

import "dotenv/config";

import prisma from "@/lib/prisma";

async function main() {
  console.log("Backfilling Lead.stage CONVERTED -> WON…");

  // Print the ids BEFORE writing. Once rewritten, a backfilled row is
  // indistinguishable from a lead that was always WON — the data half of this
  // change is not reversible, so this list is the only record of what moved.
  // Ids only, deliberately: lead names are customer names, and this output ends
  // up in terminal scrollback and deploy logs.
  const affected = await prisma.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "Lead" WHERE "stage"::text = 'CONVERTED' ORDER BY "id"
  `;

  if (affected.length === 0) {
    console.log("  nothing to do — no rows hold CONVERTED.");
    return;
  }

  console.log(`  ${affected.length} row(s) will change:`);
  console.log(`    ids: ${affected.map((row) => row.id).join(", ")}`);

  const updated = await prisma.$executeRaw`
    UPDATE "Lead" SET "stage" = 'WON' WHERE "stage"::text = 'CONVERTED'
  `;
  console.log(`  rewrote ${updated} row(s).`);

  const [{ remaining }] = await prisma.$queryRaw<{ remaining: bigint }[]>`
    SELECT COUNT(*) AS remaining FROM "Lead" WHERE "stage"::text = 'CONVERTED'
  `;
  if (Number(remaining) !== 0) {
    throw new Error(
      `${remaining} row(s) still hold CONVERTED — investigate before migrating.`,
    );
  }
  console.log("  verified 0 remaining at this instant.");
  console.log(
    "  the phase B migration re-runs the same UPDATE transactionally,",
  );
  console.log("  so a late write cannot slip through the gap.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
