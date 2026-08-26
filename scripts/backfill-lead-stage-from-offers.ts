// One-time backfill: mark leads won whose offers already reached
// CONTRACT_SIGNED or PROJECT before the lead-stage sync existed.
//
// The modern offer lifecycle never wrote Lead.stage, so every deal signed to
// date has a lead sitting wherever a human last dragged it. Wiring the sync
// only fixes future transitions; without this, the highest-value closed deals
// stay invisible to win rate and keep inflating open pipeline. On staging that
// was four signed-or-building deals and not one lead marked won, including a live
// project worth $945k whose lead read "Meeting Scheduled".
//
// wonAt comes from OfferStatusEvent.at — the real moment the contract was signed,
// not today. Using now() would dump every historical win into the current
// 90-day window, spike the win-rate card on the day this runs, and cliff it
// 90 days later. Offers with no recorded event fall back to the offer's own
// updatedAt and are reported separately so the approximation is visible.
//
// Run: pnpm backfill:lead-stage-from-offers
// Add --commit to write; the default is a dry run.
//
// Idempotent: only touches leads not already in a won stage, and never
// disturbs a lead a human closed as lost.

import "dotenv/config";

import type { LeadStage } from "@prisma/client";

import { stageDef } from "@/lib/leads/pipeline-stages";
import prisma from "@/lib/prisma";

const COMMIT = process.argv.includes("--commit");
// Derived from the stage ladder, not re-listed — PIPELINE_STAGES is the one
// definition of what an outcome means.
const isWon = (stage: LeadStage) => stageDef(stage).outcome === "WON";
const isLost = (stage: LeadStage) => stageDef(stage).outcome === "LOST";

async function main() {
  console.log(COMMIT ? "Backfilling lead stages from offers…" : "DRY RUN — pass --commit to write");

  const offers = await prisma.offer.findMany({
    where: { isActive: true, offerStatus: { in: ["CONTRACT_SIGNED", "PROJECT"] } },
    select: {
      id: true,
      offerStatus: true,
      updatedAt: true,
      leadId: true,
      lead: { select: { id: true, stage: true, wonAt: true } },
      statusEvents: {
        where: { toStatus: { in: ["CONTRACT_SIGNED", "PROJECT"] } },
        orderBy: { at: "asc" },
        take: 1,
        select: { at: true, toStatus: true },
      },
    },
  });

  console.log(`  ${offers.length} signed or building offer(s) found`);

  let moved = 0;
  let skippedWon = 0;
  let skippedLost = 0;
  let approximated = 0;

  for (const offer of offers) {
    const lead = offer.lead;
    if (!lead) continue;

    if (isWon(lead.stage)) {
      skippedWon++;
      continue;
    }
    // Never overrule a human who recorded this as lost. Surface it instead —
    // a signed contract on a lead marked lost is a contradiction a person
    // should look at, not something a script should silently resolve.
    if (isLost(lead.stage)) {
      skippedLost++;
      console.log(
        `    CONFLICT lead #${lead.id} is ${lead.stage} but offer ${offer.id} is ${offer.offerStatus} — left alone`,
      );
      continue;
    }

    const event = offer.statusEvents[0];
    const wonAt = event?.at ?? offer.updatedAt;
    if (!event) approximated++;

    console.log(
      `    lead #${lead.id}: ${lead.stage} -> CONVERTED  wonAt=${wonAt.toISOString().slice(0, 10)}` +
        (event ? "" : "  (approximated from offer.updatedAt)"),
    );

    if (COMMIT) {
      await prisma.lead.update({
        where: { id: lead.id },
        // CONVERTED, not WON: same outcome, but the only one of the two the
        // stage picker offers. Must match the migration this previews.
        data: { stage: "CONVERTED", wonAt, lostAt: null },
      });
    }
    moved++;
  }

  console.log("");
  console.log(`  ${moved} lead(s) ${COMMIT ? "moved to" : "would move to"} CONVERTED`);
  console.log(`  ${skippedWon} already won, ${skippedLost} left alone as lost`);
  if (approximated > 0) {
    console.log(`  ${approximated} had no status event; wonAt approximated from offer.updatedAt`);
  }
  if (!COMMIT) console.log("\n  nothing written — re-run with --commit");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
