// One-time seed: builds the AdminOfferContent singleton row from the existing
// static data (OFFER_SEQUENCE_MAPPINGS, INITIAL_ALLOWANCES, INITIAL_EXCLUSIONS,
// INITIAL_OFFER_DRAFT, INITIAL_AREA_CALCULATOR) so the admin UI starts with
// the full ~60-row cost schedule and the current default content.
//
// Run: pnpm tsx scripts/seed-admin-offer-content.ts
//
// After running, verify the admin UI (/offers/admin) shows the full cost
// schedule with the same figures the static file produced, then create a new
// offer and compare line-by-line before relying on it for real offers.

import "dotenv/config";
import { OFFER_SEQUENCE_MAPPINGS } from "@/lib/offer/workspace-sequence-mapping";
import {
  INITIAL_ALLOWANCES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
} from "@/lib/offer/workspace-model";
import {
  DEFAULT_RATE_CONSTANTS,
  type RateConstantKey,
} from "@/lib/offer/formula-variables";
import type {
  AdminOfferContent,
  CostScheduleRow,
  OfferAllowance,
  OfferExclusion,
} from "@/types/admin-offer-content";
import {
  updateBuildScope,
  updateCostSchedule,
  updateOfferScope,
  updateOfferContent,
  getAdminOfferContentNonCache,
} from "@/lib/data/admin-offer-content";

async function seed() {
  console.log("Building seed payload from static data…");

  // Cost schedule rows — one per OFFER_SEQUENCE_MAPPINGS entry, all starting
  // priceMode:"none" (INITIAL_COST_BY_TASK is empty — every task starts at $0).
  const rows: CostScheduleRow[] = OFFER_SEQUENCE_MAPPINGS.map((mapping) => ({
    id: `seed-${mapping.taskKey}`,
    taskKey: mapping.taskKey,
    phase: inferPhaseLabel(mapping.taskName),
    task: mapping.taskName,
    mapId: undefined,
    defaultInclude: false,
    priceMode: "none",
  }));

  // Rate constants — the 11 admin-editable defaults from
  // DEFAULT_RATE_CONSTANTS. The old calculator-embedded rates (slabRatePerSqm,
  // dropEdgeRate, steelAllowance, etc.) have been replaced by the new
  // constants and estimator-input model.
  const rateConstants: Partial<Record<RateConstantKey, number>> = {
    ...DEFAULT_RATE_CONSTANTS,
  };

  // Allowances — map INITIAL_ALLOWANCES to admin OfferAllowance shape.
  const allowances: OfferAllowance[] = INITIAL_ALLOWANCES.map((a, i) => ({
    id: `seed-allowance-${i + 1}`,
    name: a.label,
    category:
      a.amountType === "rate_per_sqm"
        ? "per-sqm"
        : a.amountType === "included_note"
          ? "note-only"
          : "package",
    amount: a.amount,
    variationRule: a.variationRule,
  }));

  // Exclusions — map INITIAL_EXCLUSIONS to admin OfferExclusion shape.
  const exclusions: OfferExclusion[] = INITIAL_EXCLUSIONS.map((e, i) => ({
    id: `seed-exclusion-${i + 1}`,
    name: e.label,
    description: e.description,
    variationRule: e.variationRule,
    exclusionKind:
      e.category === "owner_selection" ? "owner_supplied" : "excluded",
  }));

  const payload: AdminOfferContent = {
    buildScope: [...INITIAL_OFFER_DRAFT.inclusionHighlights],
    costSchedule: { rows, rateConstants },
    offerScope: { allowances, exclusions },
    offerContent: {
      headline: INITIAL_OFFER_DRAFT.headline,
      introText: INITIAL_OFFER_DRAFT.introText,
      // The admin's inclusion copy is the page-4 wording, which now lives as
      // the `summary` on each inclusion entry.
      inclusions: [...INITIAL_OFFER_DRAFT.inclusionHighlights],
      termsAndConditions: INITIAL_OFFER_DRAFT.termsSummary,
    },
    hbfcClaim: {
      claimAmount: 800_000,
    }
  };

  console.log(
    `Seeding: ${rows.length} cost rows, ${allowances.length} allowances, ` +
      `${exclusions.length} exclusions, ` +
      `${Object.keys(rateConstants).length} rate constants`,
  );

  // Ensure the singleton row exists, then write each section via the Phase 1
  // update helpers so the payload goes through the same Zod validation as any
  // admin-authored save.
  await getAdminOfferContentNonCache();
  await updateBuildScope(payload.buildScope);
  await updateCostSchedule(payload.costSchedule);
  await updateOfferScope(payload.offerScope);
  await updateOfferContent(payload.offerContent);

  console.log("Seed complete. Verify at /offers/admin.");
}

// Derive a phase label from the task name. The static data has no explicit
// phase field; the stageCode letter (A-O) from inferOfferStageCode maps to
// OFFER_STAGE_CATALOG. We use the stage name as the phase label — this is
// admin-only display grouping, not a runtime concept.
function inferPhaseLabel(taskName: string): string {
  const lower = taskName.toLowerCase();
  if (
    /general|plan|basix|nathers|permit|survey|engineer|council|legal|service fee|sydney water|sewer|warranty|licence|admin/.test(
      lower,
    )
  )
    return "GENERAL REQUIREMENTS";
  if (/temporary fence|scaffold|bin|pest/.test(lower))
    return "SITE PREPARATION";
  if (/slab|drop edge|pier|concrete|excavation|clean site/.test(lower))
    return "FOOTINGS & SLAB";
  if (/frame|steel|roof/.test(lower)) return "FRAME & ROOF";
  if (/window|brick|garage door|render|cladding|facade/.test(lower))
    return "EXTERNAL ENVELOPE";
  if (/plumb|hot water|gas/.test(lower)) return "PLUMBING";
  if (/electric|light/.test(lower)) return "ELECTRICAL";
  if (/air conditioning|hvac/.test(lower)) return "HVAC";
  if (/insulation|gyprock|stair|door|lock|carpenter|wardrobe|floor/.test(lower))
    return "INTERNAL LININGS";
  if (/waterproof|tile|tiling|sand|cement/.test(lower))
    return "WATERPROOFING & TILING";
  if (/kitchen|bath|stone|shower|appliance/.test(lower))
    return "KITCHEN, BATH & JOINERY";
  if (/pc item|selection|tapware|fixture/.test(lower))
    return "PC ITEMS & FIXTURES";
  if (/paint|silicon/.test(lower)) return "PAINTING";
  if (/driveway|landsc|fence|pool|solar|balcony|void/.test(lower))
    return "EXTERNAL WORKS";
  return "COMPLETION & HANDOVER";
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});