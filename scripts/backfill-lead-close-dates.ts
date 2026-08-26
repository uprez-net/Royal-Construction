// One-time backfill: approximate wonAt/lostAt for leads that closed before
// close-date tracking began, using updatedAt.
//
// updatedAt is a POOR proxy — any edit bumps it, and won leads receive far
// more post-close writes (offer attach, WON->CONVERTED flip, project handoff)
// than lost ones. Results are therefore flagged in the UI via
// CLOSE_DATE_TRACKING_START, and the flag clears itself once the 90-day
// win-rate window no longer reaches back this far. This is a deliberate
// one-time approximation so the win-rate card has history on launch day, not
// an ongoing mechanism.
//
// Run: pnpm tsx scripts/backfill-lead-close-dates.ts
//
// Idempotent: only writes where the target column is still NULL, so a re-run
// reports 0, 0 and changes nothing.

import "dotenv/config";
import { Prisma } from "@prisma/client";

import { PIPELINE_STAGES } from "@/lib/leads/pipeline-stages";
import prisma from "@/lib/prisma";

const stagesWithOutcome = (outcome: "WON" | "LOST") =>
  Object.values(PIPELINE_STAGES)
    .filter((stage) => stage.outcome === outcome)
    .map((stage) => stage.code);

const WON_STAGES = stagesWithOutcome("WON");
const LOST_STAGES = stagesWithOutcome("LOST");

async function main() {
  console.log("Backfilling lead close dates…");
  console.log(`  won stages:  ${WON_STAGES.join(", ")}`);
  console.log(`  lost stages: ${LOST_STAGES.join(", ")}`);

  // Set from the row's own updatedAt in a single statement — updateMany cannot
  // copy one column into another.
  const wonUpdated = await prisma.$executeRaw`
    UPDATE "Lead"
       SET "wonAt" = "updatedAt"
     WHERE "wonAt" IS NULL
       AND "stage"::text IN (${Prisma.join(WON_STAGES)})
  `;

  const lostUpdated = await prisma.$executeRaw`
    UPDATE "Lead"
       SET "lostAt" = "updatedAt"
     WHERE "lostAt" IS NULL
       AND "stage"::text IN (${Prisma.join(LOST_STAGES)})
  `;

  console.log(`  stamped ${wonUpdated} won, ${lostUpdated} lost`);
  console.log("Done. Re-running is safe — it will report 0, 0.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
