import { getAdminOfferContent } from "@/lib/data/admin-offer-content";
import {
  inferOfferStageCode,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import {
  OFFER_SEQUENCE_MAPPINGS,
  type OfferSequenceMapping,
} from "@/lib/offer/workspace-sequence-mapping";
import {
  INITIAL_AREA_CALCULATOR,
  type OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import {
  buildFormulaScope,
  evaluateCostFormula,
} from "@/lib/offer/formula-evaluator";
import type {
  AreaMeasurementKey,
  RateConstantKey,
} from "@/lib/offer/formula-variables";
import type { AdminOfferContent } from "@/types/admin-offer-content";
import { DEFAULT_RATE_CONSTANTS } from "@/lib/offer/formula-variables";

export type AdminOfferPrefill = {
  buildScope: readonly string[];
  costLines: readonly OfferWorkspaceCostLine[];
  allowances: readonly OfferWorkspaceScopeItem[];
  exclusions: readonly OfferWorkspaceScopeItem[];
  draft: OfferDocumentDraft;
  areaCalculator: OfferAreaCalculator;
  rateConstants: Partial<Record<RateConstantKey, number>>;
};

// The lookup keyed by taskKey — built once per prefill, used to join admin
// rows to the static per-task metadata (buildingSequenceTasks, tradesToBook,
// milestoneStages, offerTenderWording) that the admin never edits.
function indexMappingsByKey(): ReadonlyMap<string, OfferSequenceMapping> {
  const map = new Map<string, OfferSequenceMapping>();
  for (const mapping of OFFER_SEQUENCE_MAPPINGS) {
    map.set(mapping.taskKey, mapping);
  }
  return map;
}

// Resolve admin cost-schedule rows into runtime OfferWorkspaceCostLine[] by
// joining on taskKey. Lines whose taskKey matches a static mapping carry the
// mapping's rich metadata; admin rows with no static counterpart (a task the
// admin added) still appear with empty metadata. Static mappings with no
// admin row are also included (fallback) so a missing admin row never silently
// drops a task from every future offer.
function resolveCostLines(
  adminContent: AdminOfferContent,
  mappingByKey: ReadonlyMap<string, OfferSequenceMapping>,
): readonly OfferWorkspaceCostLine[] {
  const lines: OfferWorkspaceCostLine[] = [];
  const seenKeys = new Set<string>();

  for (const row of adminContent.costSchedule.rows) {
    seenKeys.add(row.taskKey);
    const mapping = mappingByKey.get(row.taskKey) ?? null;
    const itemName = (row.task || mapping?.taskName) ?? "";
    const offerTenderLineItem =
      mapping?.offerTenderWording ?? row.task ?? "";
    const costExGst =
      row.priceMode === "fixed"
        ? row.value
        : row.priceMode === "formula"
          ? 0 // formula costExGst deferred — needs measurements (resolveFormulaCostLines)
          : 0;
    lines.push({
      id: `task-${row.taskKey}`,
      stageCode: inferOfferStageCode(itemName),
      itemName,
      buildingSequenceTasks: mapping?.buildingSequenceTasks ?? [],
      offerTenderLineItem,
      tradeOrVendor: mapping?.tradesToBook.join(", ") ?? "",
      notesOrSpec: offerTenderLineItem,
      costExGst,
      includedInContract: row.defaultInclude,
      formula: row.priceMode === "formula" ? row.formula : undefined,
    });
  }

  // Fallback: static mappings with no admin row. These shouldn't exist after
  // the seed, but guard for drift so a task never silently disappears.
  for (const mapping of OFFER_SEQUENCE_MAPPINGS) {
    if (!seenKeys.has(mapping.taskKey)) {
      lines.push({
        id: `task-${mapping.taskKey}`,
        stageCode: inferOfferStageCode(mapping.taskName),
        itemName: mapping.taskName,
        buildingSequenceTasks: mapping.buildingSequenceTasks,
        offerTenderLineItem: mapping.offerTenderWording,
        tradeOrVendor: mapping.tradesToBook.join(", "),
        notesOrSpec: mapping.offerTenderWording,
        costExGst: 0,
        includedInContract: false,
      });
    }
  }

  return lines;
}

// Admin allowance category → runtime scope item category + amountType.
function resolveAllowances(
  adminContent: AdminOfferContent,
): readonly OfferWorkspaceScopeItem[] {
  return adminContent.offerScope.allowances.map((a, index) => {
    const isNote = a.category === "note-only";
    return {
      id: `admin-allowance-${index + 1}-${a.id}`,
      category: "prime_cost",
      amountType: isNote
        ? "included_note"
        : a.category === "per-sqm"
          ? "rate_per_sqm"
          : "fixed_amount",
      label: a.name,
      description: a.variationRule,
      amount: a.amount,
      unit: a.category === "per-sqm" ? "sqm" : a.category === "per-lm" ? "lm" : "package",
      variationRule: a.variationRule,
      includedInOfferDocument: true,
    } satisfies OfferWorkspaceScopeItem;
  });
}

// Admin exclusions → runtime scope items. exclusionKind drives the runtime
// category ("excluded" → "exclusion", "owner_supplied" → "owner_selection").
function resolveExclusions(
  adminContent: AdminOfferContent,
): readonly OfferWorkspaceScopeItem[] {
  return adminContent.offerScope.exclusions.map((e, index) => ({
    id: `admin-exclusion-${index + 1}-${e.id}`,
    category: e.exclusionKind === "owner_supplied" ? "owner_selection" : "exclusion",
    amountType: "included_note" as const,
    label: e.name,
    description: e.description,
    amount: 0,
    unit: "",
    variationRule: e.variationRule,
    includedInOfferDocument: true,
  })) satisfies OfferWorkspaceScopeItem[];
}

function resolveDraft(
  adminContent: AdminOfferContent,
): OfferDocumentDraft {
  const c = adminContent.offerContent;
  return {
    headline: c.headline,
    introText: c.introText,
    inclusionBullets: c.inclusions,
    // exclusionBullets is a separate flat list — left empty here because the
    // admin's structured exclusions drive the scope panel, not the draft's
    // flat bullets. The estimator can author flat exclusion copy in the offer
    // document editor if needed.
    exclusionBullets: [],
    termsSummary: c.termsAndConditions,
  };
}

// Merge admin rate constants over the INITIAL_AREA_CALCULATOR defaults. Admin
// overrides win for any key present; the static defaults fill the rest so the
// area calculator panel always has real numbers.
function resolveAreaCalculator(
  adminContent: AdminOfferContent,
): OfferAreaCalculator {
  const rc = adminContent.costSchedule.rateConstants;
  return {
    ...INITIAL_AREA_CALCULATOR,
    ...(rc.SLAB_RATE_PER_SQM !== undefined && { slabRatePerSqm: rc.SLAB_RATE_PER_SQM }),
    ...(rc.DROP_EDGE_RATE !== undefined && { dropEdgeRate: rc.DROP_EDGE_RATE }),
    ...(rc.FRAME_GROUND_RATE_PER_SQM !== undefined && { frameGroundRatePerSqm: rc.FRAME_GROUND_RATE_PER_SQM }),
    ...(rc.FRAME_FIRST_RATE_PER_SQM !== undefined && { frameFirstRatePerSqm: rc.FRAME_FIRST_RATE_PER_SQM }),
    ...(rc.STEEL_ALLOWANCE !== undefined && { steelAllowance: rc.STEEL_ALLOWANCE }),
    ...(rc.FRAME_INSTALL_ALLOWANCE !== undefined && { frameInstallAllowance: rc.FRAME_INSTALL_ALLOWANCE }),
    ...(rc.BRICKS_PER_SQM !== undefined && { bricksPerSqm: rc.BRICKS_PER_SQM }),
    ...(rc.SAND_RATE_PER_THOUSAND_BRICKS !== undefined && { sandRatePerThousandBricks: rc.SAND_RATE_PER_THOUSAND_BRICKS }),
    ...(rc.CEMENT_RATE_PER_HUNDRED_BRICKS !== undefined && { cementRatePerHundredBricks: rc.CEMENT_RATE_PER_HUNDRED_BRICKS }),
    ...(rc.TILE_SUPPLY_RATE_PER_SQM !== undefined && { tileSupplyRatePerSqm: rc.TILE_SUPPLY_RATE_PER_SQM }),
    ...(rc.TILER_RATE_PER_SQM !== undefined && { tilerRatePerSqm: rc.TILER_RATE_PER_SQM }),
  };
}

// Re-evaluate every formula-mode cost line once project measurements are
// known. Called client-side from new-offer-workspace.tsx whenever the job's
// floor areas or the area calculator's measurements change.
export function reevaluateFormulaCostLines(
  costLines: readonly OfferWorkspaceCostLine[],
  rateConstants: Partial<Record<RateConstantKey, number>>,
  job: Pick<OfferWorkspaceJob, "groundFloorSqm" | "firstFloorSqm" | "garageSqm" | "alfrescoPorchSqm" | "porchSqm" | "grannyFlatSqm">,
  area: OfferAreaCalculator,
): readonly OfferWorkspaceCostLine[] {
  const measurements: Partial<Record<AreaMeasurementKey, number>> = {
    SLAB_AREA:
      job.groundFloorSqm +
      job.alfrescoPorchSqm +
      job.porchSqm +
      job.garageSqm +
      job.grannyFlatSqm,
    DROP_EDGE_LM: area.dropEdgeLinealMeters,
    GROUND_FLOOR_SQM: job.groundFloorSqm,
    FIRST_FLOOR_SQM: job.firstFloorSqm,
    TILE_AREA_SQM: area.tileAreaSqm,
    BRICK_GROUND_LM: area.brickGroundLinealMeters,
    BRICK_FIRST_LM: area.brickFirstLinealMeters,
    BRICK_GROUND_HEIGHT: area.brickGroundHeight,
    BRICK_FIRST_HEIGHT: area.brickFirstHeight,
    EXTRA_TRUCK_COST: area.extraTruckCost,
  };
  const scope = buildFormulaScope(rateConstants, measurements);
  return costLines.map((line) =>
    line.formula
      ? { ...line, costExGst: evaluateCostFormula(line.formula, scope) }
      : line,
  );
}

// The entry point. Fetches AdminOfferContent from the DB, joins it against
// the static sequence mappings, and returns the runtime initial state for a
// new offer. Called server-side from the offer page.
export async function buildAdminOfferPrefill(): Promise<AdminOfferPrefill> {
  const adminContent = await getAdminOfferContent();
  const mappingByKey = indexMappingsByKey();

  return {
    buildScope: adminContent.buildScope,
    costLines: resolveCostLines(adminContent, mappingByKey),
    allowances: resolveAllowances(adminContent),
    exclusions: resolveExclusions(adminContent),
    draft: resolveDraft(adminContent),
    areaCalculator: resolveAreaCalculator(adminContent),
    rateConstants: { ...DEFAULT_RATE_CONSTANTS, ...adminContent.costSchedule.rateConstants },
  };
}