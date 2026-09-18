// One-time data fix: the admin allowance "Ground floor ceiling upgrade" was
// saved with a blank variation rule on staging and production. Every new or
// still-editable offer copies admin defaults, so the blank went onto offers
// and the signed Tender with no rule for how overruns are charged (#266).
//
// Filling the admin row and bumping version is enough for still-editable
// offers: they re-apply current admin content on open. Agreed/sent offers
// keep their frozen snapshot and are left alone.
//
// Run: pnpm backfill:ceiling-upgrade-variation-rule
// Add --commit to write; the default is a dry run.
//
// Idempotent: a row that already has a rule is left unchanged.

import "dotenv/config";

import prisma from "@/lib/prisma";
import {
  CEILING_UPGRADE_VARIATION_RULE,
  GROUND_FLOOR_CEILING_UPGRADE_NAME,
  fillCeilingUpgradeVariationRule,
} from "@/lib/offer/fill-ceiling-upgrade-variation-rule";
import {
  getAdminOfferContentNonCache,
  updateOfferScope,
} from "@/lib/data/admin-offer-content-writes";

const COMMIT = process.argv.includes("--commit");

async function main() {
  console.log(
    COMMIT
      ? "Filling the Ground floor ceiling upgrade variation rule…"
      : "DRY RUN — pass --commit to write",
  );

  const content = await getAdminOfferContentNonCache();
  console.log(`  admin content version ${content.version}`);

  const result = fillCeilingUpgradeVariationRule(content.offerScope);

  if (!result.found) {
    throw new Error(
      `No allowance named "${GROUND_FLOOR_CEILING_UPGRADE_NAME}" in admin offer content.`,
    );
  }

  if (result.otherBlankAllowances.length > 0) {
    console.log(
      `  other blank allowance rule(s), not filled: ${result.otherBlankAllowances.join(", ")}`,
    );
  }

  if (!result.filled) {
    console.log(
      `  "${GROUND_FLOOR_CEILING_UPGRADE_NAME}" already has a variation rule. Nothing to do.`,
    );
    return;
  }

  console.log(
    `  would set variation rule to: ${CEILING_UPGRADE_VARIATION_RULE}`,
  );

  if (!COMMIT) {
    console.log("  dry run complete — no write.");
    return;
  }

  await updateOfferScope(result.next);
  console.log("  wrote offer scope and bumped admin content version.");
}

main()
  .catch((error) => {
    console.error("Fill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
