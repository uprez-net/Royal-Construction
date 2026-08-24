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
  calculateOfferArea,
  offerAreaBasisFromJob,
  type AreaRateConstants,
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
import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";
import type { AdminOfferContent } from "@/types/admin-offer-content";
import {
  OFFER_EXCLUDES_BULLETS,
  STANDARD_INCLUSION_ENTRIES,
  STANDARD_INCLUSION_HIGHLIGHTS,
} from "@/lib/offer/workspace-proposal-content";
import { DEFAULT_RATE_CONSTANTS } from "@/lib/offer/formula-variables";

export type AdminOfferPrefill = {
  // The AdminOfferContent.version these defaults were built from. Stamped into
  // the offer's snapshot so opening a still-editable offer can tell whether the
  // admin content has moved on since (see reapplyAdminContentIfStale).
  adminVersion: number;
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
    exclusionBullets: [
      ...OFFER_EXCLUDES_BULLETS,
      ...c.exclusions
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !OFFER_EXCLUDES_BULLETS.includes(line)),
    ],
    // Admin-configured inclusion copy IS the selling list — short lines for the
    // page beside the price. It is not schedule wording, so it no longer gets
    // turned into contract rows.
    inclusionHighlights: [
      ...STANDARD_INCLUSION_HIGHLIGHTS,
      ...c.inclusions
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 && !STANDARD_INCLUSION_HIGHLIGHTS.includes(line),
        ),
    ],
    inclusionSchedule: [
      ...STANDARD_INCLUSION_ENTRIES,
      ...c.inclusionSchedule
        .map((row) => ({
          spec: row.spec,
          category: row.category,
        }))
        .filter(
          (row) =>
            row.spec.trim().length > 0 &&
            !STANDARD_INCLUSION_ENTRIES.some(
              (standard) =>
                standard.spec === row.spec &&
                standard.category === row.category,
            ),
        ),
    ],
    termsSummary: c.termsAndConditions,
  };
}

// The area calculator now contains only project-specific estimator inputs (no
// rate constants). Rate constants flow separately through the `rateConstants`
// field. A new offer starts with all-zero inputs.
function resolveAreaCalculator(): OfferAreaCalculator {
  return { ...INITIAL_AREA_CALCULATOR };
}

// Resolve the admin rate constants (with defaults) into the typed
// AreaRateConstants shape needed by the area calculation functions.
export function resolveAreaRateConstants(
  rateConstants: Partial<Record<RateConstantKey, number>>,
): AreaRateConstants {
  const rc = { ...DEFAULT_RATE_CONSTANTS, ...rateConstants };
  return {
    dropEdgeBeamCostPerSurfaceArea: rc.DROP_EDGE_BEAM_COST_PER_SURFACE_AREA,
    priceOfEachTruck: rc.PRICE_OF_EACH_TRUCK,
    groundFloorFramePricePerSqm: rc.FRAME_GROUND_RATE_PER_SQM,
    firstFloorFramePricePerSqm: rc.FRAME_FIRST_RATE_PER_SQM,
    sandRatePerThousandBricks: rc.SAND_RATE_PER_THOUSAND_BRICKS,
    cementRatePerHundredBricks: rc.CEMENT_RATE_PER_HUNDRED_BRICKS,
    brickPricePerBrick: rc.BRICK_PRICE_PER_BRICK,
    brickLayingPricePerBrick: rc.BRICK_LAYING_PRICE_PER_BRICK,
    tilePricePerTile: rc.TILE_PRICE_PER_TILE,
    tilingRatePerSqm: rc.TILING_RATE_PER_SQM,
    flooringRatePerSqm: rc.FLOORING_RATE_PER_SQM,
    slabCostPerSqm: rc.SLAB_COST_PER_SQM,
  };
}

// Re-evaluate every formula-mode cost line once project measurements are
// known. Called client-side from new-offer-workspace.tsx whenever the job's
// floor areas or the area calculator's inputs change. The formula scope
// includes Phase 1 calculated values (totals from the area calculator) so
// admin formulas can reference them directly.
export function reevaluateFormulaCostLines(
  costLines: readonly OfferWorkspaceCostLine[],
  rateConstants: Partial<Record<RateConstantKey, number>>,
  job: Pick<
    OfferWorkspaceJob,
    | "groundFloorSqm"
    | "firstFloorSqm"
    | "garageSqm"
    | "alfrescoPorchSqm"
    | "porchSqm"
    | "grannyFlatSqm"
    | "balconySqm"
    | "voidSqm"
    | "kitchenSqm"
    | "bedrooms"
    | "bathrooms"
    | "linenCount"
  >,
  area: OfferAreaCalculator,
): readonly OfferWorkspaceCostLine[] {
  const resolvedRates = resolveAreaRateConstants(rateConstants);
  const basis = offerAreaBasisFromJob(job);
  const calc = calculateOfferArea(basis, area, resolvedRates);

  const measurements: Partial<Record<AreaMeasurementKey, number>> = {
    TOTAL_SLAB_COST: calc.totalSlabCost,
    TOTAL_DROP_EDGE_BEAM_COST: calc.totalDropEdgeBeamCost,
    TOTAL_TRUCK_PRICE: calc.totalTruckPrice,
    TOTAL_GROUND_FLOOR_FRAME_COST: calc.totalGroundFloorFrameCost,
    TOTAL_FIRST_FLOOR_FRAME_COST: calc.totalFirstFloorFrameCost,
    TOTAL_GROUND_FLOOR_AREA: calc.totalGroundFloorArea,
    STEEL: area.steel,
    INSTALLER: area.installer,
    EAVES: area.eaves,
    TOTAL_BRICKS_REQUIRED: calc.totalBricksRequired,
    TOTAL_SAND_COST: calc.totalSandCost,
    TOTAL_CEMENT_COST: calc.totalCementCost,
    TIE_COST: area.tieCost,
    TOTAL_TILES_REQUIRED: calc.totalTilesRequired,
    KITCHEN_AREA: basis.kitchenSqm,
    TOTAL_AREA:
      basis.groundFloorSqm +
      basis.firstFloorSqm +
      basis.garageSqm +
      basis.alfrescoSqm +
      basis.porchSqm +
      basis.grannyFlatSqm +
      basis.balconySqm +
      basis.voidSqm,
    TOTAL_SHOWERS: job.bathrooms,
    TOTAL_BEDROOMS: job.bedrooms,
    TOTAL_LINENS: job.linenCount,
  };

  const scope = buildFormulaScope(rateConstants, measurements);
  return costLines.map((line) =>
    line.formula
      ? { ...line, costExGst: Math.ceil(evaluateCostFormula(line.formula, scope) / 1000) * 1000 }
      : line,
  );
}

// Re-seed an EXISTING offer's admin-derived fields from the current admin
// defaults, leaving everything project-specific (job, areas, pricing, payment
// schedule, images, tender gate) exactly as the estimator left it. Called when a
// still-editable offer is opened and its stamped admin version is behind the
// live one; an agreed/sent offer never reaches here (see
// reapplyAdminContentIfStale in lib/data/offer-workspace.ts).
//
// Allowances, exclusions and the draft copy are pure admin content, so they are
// replaced outright. Cost lines are a MERGE: the admin set decides which tasks
// exist and carries the admin's own prices, but a line the admin does not price
// (priceMode "none", or a formula whose cost is deferred — both arrive as 0)
// keeps the offer's existing figure and include flag. That number is the
// estimator's project measurement, not a stale default, and replacing it with 0
// would silently zero work already done.
export function applyAdminPrefillToSnapshot(
  snapshot: OfferWorkspaceSnapshot,
  prefill: AdminOfferPrefill,
): OfferWorkspaceSnapshot {
  const existingById = new Map(snapshot.lines.map((line) => [line.id, line]));
  return {
    ...snapshot,
    lines: prefill.costLines.map((line) => {
      const existing = existingById.get(line.id);
      if (!existing || line.costExGst !== 0) {
        return line;
      }
      return {
        ...line,
        costExGst: existing.costExGst,
        includedInContract: existing.includedInContract,
      };
    }),
    allowances: prefill.allowances,
    exclusions: prefill.exclusions,
    draft: prefill.draft,
    adminContentVersion: prefill.adminVersion,
  };
}

// The entry point. Fetches AdminOfferContent from the DB, joins it against
// the static sequence mappings, and returns the runtime initial state for a
// new offer. Called server-side from the offer page.
export async function buildAdminOfferPrefill(): Promise<AdminOfferPrefill> {
  const adminContent = await getAdminOfferContent();
  const mappingByKey = indexMappingsByKey();

  return {
    adminVersion: adminContent.version,
    buildScope: adminContent.buildScope,
    costLines: resolveCostLines(adminContent, mappingByKey),
    allowances: resolveAllowances(adminContent),
    exclusions: resolveExclusions(adminContent),
    draft: resolveDraft(adminContent),
    areaCalculator: resolveAreaCalculator(),
    rateConstants: { ...DEFAULT_RATE_CONSTANTS, ...adminContent.costSchedule.rateConstants },
  };
}
