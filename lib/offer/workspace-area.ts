import { roundCurrency } from "@/lib/offer/pricing";
import {
  CURRENT_CALC_VERSION,
  LEGACY_CALC_VERSION,
} from "@/lib/offer/calc-version";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";

// The floor-area geometry that feeds the Frame calculations. This is NOT
// owned here — it is the single source of truth captured in Job setup and
// derived from the job via offerAreaBasisFromJob(). The helper never lets the
// estimator re-type these; that duplication is exactly what drifted before.
export type OfferAreaBasis = {
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly garageSqm: number;
  readonly alfrescoSqm: number;
  readonly porchSqm: number;
  readonly kitchenSqm: number;
  readonly grannyFlatSqm: number;
  readonly balconySqm: number;
  readonly voidSqm: number;
  // Already 0 when the job has no second floor — offerAreaBasisFromJob gates
  // it on hasSecondFloor, so nothing downstream has to check the toggle.
  readonly secondFloorSqm: number;
};

// The estimator's project-specific inputs for the slab / frame / brick / tile
// sections. Combined with an OfferAreaBasis (floor areas from Job setup) and
// a set of admin rate constants it produces the area cost packages.
//
// Rate constants (drop edge beam cost per surface area, truck price, frame
// rates, sand/cement rates) are NOT stored here — they come from the admin
// cost-schedule configuration (see formula-variables.ts).
export type OfferAreaCalculator = {
  // ── Slab inputs ──
  readonly slabCost: number;
  readonly dropEdgeBeamSurfaceArea: number;
  readonly numberOfTrucks: number;
  // ── Frame inputs ──
  readonly steel: number;
  readonly installer: number;
  readonly eaves: number;
  // ── Brick inputs ──
  readonly bricksGroundFloor: number;
  readonly bricksFirstFloor: number;
  readonly bricksPillar: number;
  readonly tieCost: number;
  // ── Tile inputs ──
  // The estimator's figure for a tile area, in place of the calculated one.
  // Absent means "use the calculation". Never stored as null: the persisted
  // calculator is a plain number record, so clearing removes the key.
  readonly groundFloorTilesSqm?: number;
  readonly bathroomTilesSqm?: number;
};

// Calculated results per section. Every value is derived from the calculator
// inputs + floor-area basis + admin rate constants — never user-editable.
export type OfferAreaCalculation = {
  // ── Slab ──
  readonly totalDropEdgeBeamCost: number;
  readonly totalTruckPrice: number;
  readonly totalSlabCost: number;
  readonly slabCost: number;
  // ── Frame ──
  readonly totalGroundFloorArea: number;
  readonly totalGroundFloorFrameCost: number;
  readonly totalFirstFloorArea: number;
  readonly totalFirstFloorFrameCost: number;
  readonly totalFrameCost: number;
  // ── Bricks ──
  readonly totalBricksRequired: number;
  readonly sandRequiredForBricks: number;
  readonly totalSandCost: number;
  readonly cementRequiredForBricks: number;
  readonly totalCementCost: number;
  readonly totalBrickMaterialCost: number;
  // ── Tiles (sqm) ──
  readonly groundFloorTilesSqm: number;
  readonly bathroomTilesSqm: number;
  readonly tilesWasted: number;
  readonly totalTilesRequired: number;
};

// Rate constants needed by the area calculations. Resolved from the admin
// cost-schedule configuration (DEFAULT_RATE_CONSTANTS + admin overrides).
export type AreaRateConstants = {
  readonly dropEdgeBeamCostPerSurfaceArea: number;
  readonly priceOfEachTruck: number;
  readonly groundFloorFramePricePerSqm: number;
  readonly firstFloorFramePricePerSqm: number;
  readonly sandRatePerThousandBricks: number;
  readonly cementRatePerHundredBricks: number;
  readonly brickPricePerBrick: number;
  readonly brickLayingPricePerBrick: number;
  readonly tilePricePerTile: number;
  readonly tilingRatePerSqm: number;
  readonly flooringRatePerSqm: number;
  readonly slabCostPerSqm: number;
};

export const EMPTY_AREA_BASIS: OfferAreaBasis = {
  groundFloorSqm: 0,
  firstFloorSqm: 0,
  garageSqm: 0,
  alfrescoSqm: 0,
  porchSqm: 0,
  grannyFlatSqm: 0,
  balconySqm: 0,
  voidSqm: 0,
  kitchenSqm: 0,
  secondFloorSqm: 0,
};

// Fresh-offer defaults: every estimator input starts at zero. Rate constants
// are resolved separately from the admin configuration.
export const INITIAL_AREA_CALCULATOR: OfferAreaCalculator = {
  slabCost: 0,
  dropEdgeBeamSurfaceArea: 0,
  numberOfTrucks: 0,
  steel: 0,
  installer: 0,
  eaves: 0,
  bricksGroundFloor: 0,
  bricksFirstFloor: 0,
  bricksPillar: 0,
  tieCost: 0,
};

// Job setup owns the floor areas; the helper reads them through this adapter.
// Note the job stores the alfresco figure under `alfrescoPorchSqm`.
export function offerAreaBasisFromJob(
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
    | "hasSecondFloor"
    | "secondFloorSqm"
  >,
): OfferAreaBasis {
  return {
    groundFloorSqm: job.groundFloorSqm,
    firstFloorSqm: job.firstFloorSqm,
    garageSqm: job.garageSqm,
    alfrescoSqm: job.alfrescoPorchSqm,
    porchSqm: job.porchSqm,
    grannyFlatSqm: job.grannyFlatSqm,
    balconySqm: job.balconySqm,
    voidSqm: job.voidSqm,
    kitchenSqm: job.kitchenSqm,
    secondFloorSqm: job.hasSecondFloor ? job.secondFloorSqm : 0,
  };
}

// The total build area as PRINTED and as published to the cost-formula scope.
// Three call sites computed this by hand, character for character: the print
// template's getTotalAreaSqm, the TOTAL_AREA formula variable, and the Job setup
// card. They now share this one.
//
// This is deliberately NOT getAreaBasisTotalSqm below. That one applies
// roundCurrency and sums in a different order, and it feeds the pricing chain.
// Floating-point addition is not associative, so folding the two together could
// shift a printed figure at the second decimal. Keep them separate, and keep the
// term order below exactly as it is.
export function rawTotalAreaSqm(basis: OfferAreaBasis): number {
  return (
    basis.groundFloorSqm
    + basis.firstFloorSqm
    + basis.garageSqm
    + basis.alfrescoSqm
    + basis.porchSqm
    + basis.grannyFlatSqm
    + basis.balconySqm
    + basis.voidSqm
    // Last on purpose: every offer saved before the second floor existed has
    // 0 here, and x + 0 is exactly x, so no stored total moves.
    + basis.secondFloorSqm
  );
}

export function getAreaBasisTotalSqm(basis: OfferAreaBasis): number {
  return roundCurrency(
    basis.groundFloorSqm
      + basis.firstFloorSqm
      + basis.alfrescoSqm
      + basis.porchSqm
      + basis.garageSqm
      + basis.voidSqm
      + basis.grannyFlatSqm
      + basis.balconySqm
      // Last, for the same reason as in rawTotalAreaSqm.
      + basis.secondFloorSqm,
  );
}

// ─── Pure per-section calculation functions (unit-testable) ───

export function calculateSlab(
  basis: OfferAreaBasis,
  area: Pick<
    OfferAreaCalculator,
    "slabCost" | "dropEdgeBeamSurfaceArea" | "numberOfTrucks"
  >,
  rates: Pick<
    AreaRateConstants,
    "dropEdgeBeamCostPerSurfaceArea" | "priceOfEachTruck" | "slabCostPerSqm"
  >,
): {
  readonly totalDropEdgeBeamCost: number;
  readonly totalTruckPrice: number;
  readonly totalSlabCost: number;
  readonly slabCost: number;
} {
  const totalDropEdgeBeamCost = roundCurrency(
    area.dropEdgeBeamSurfaceArea * rates.dropEdgeBeamCostPerSurfaceArea,
  );
  const totalTruckPrice = roundCurrency(
    area.numberOfTrucks * rates.priceOfEachTruck,
  );
  const slabCost = roundCurrency(
    (basis.groundFloorSqm
      + basis.alfrescoSqm
      + basis.porchSqm
      + basis.garageSqm
      + basis.grannyFlatSqm)
      * rates.slabCostPerSqm,
  );
  const totalSlabCost = roundCurrency(
    slabCost + totalDropEdgeBeamCost + totalTruckPrice,
  );
  return { totalDropEdgeBeamCost, totalTruckPrice, totalSlabCost, slabCost };
}

// Thrown when an offer names calculation rules this build does not carry — a
// rollback past a newer version. Deliberately loud and local: the alternative is
// falling back to legacy maths, which reprices an offer under rules it was never
// quoted on. Callers screen with isSupportedCalcVersion and show the workspace
// read-only instead of recomputing.
export class UnsupportedCalcVersionError extends Error {
  constructor(readonly calcVersion: number) {
    super(
      `This offer was priced under calculation rules v${calcVersion}, which this build does not support.`,
    );
    this.name = "UnsupportedCalcVersionError";
  }
}

// The first-floor area the frame is priced on.
//
// v1 is a verbatim transcription of the expression this function replaced. Do
// not "simplify" it or fold it into the v2 branch: it is the historical record
// for every offer minted before the pin, and floating-point addition is not
// associative, so re-deriving it can move a stored figure.
function frameFirstFloorAreaSqm(
  basis: OfferAreaBasis,
  calcVersion: number,
): number {
  switch (calcVersion) {
    // The second floor is framed at the upper-floor rate under both rules. It
    // is appended LAST to each historical expression rather than worked into
    // it: every offer minted before it existed carries 0, and x + 0 is exactly
    // x, so neither version's stored figures move.
    case LEGACY_CALC_VERSION:
      return roundCurrency(
        basis.firstFloorSqm + basis.balconySqm + basis.secondFloorSqm,
      );
    case CURRENT_CALC_VERSION:
      // A void is a hole in the first floor, but the frame still spans it.
      return roundCurrency(
        basis.firstFloorSqm
          + basis.balconySqm
          + basis.voidSqm
          + basis.secondFloorSqm,
      );
    default:
      throw new UnsupportedCalcVersionError(calcVersion);
  }
}

export function calculateFrame(
  basis: OfferAreaBasis,
  area: Pick<OfferAreaCalculator, "steel" | "installer" | "eaves">,
  rates: Pick<
    AreaRateConstants,
    "groundFloorFramePricePerSqm" | "firstFloorFramePricePerSqm"
  >,
  calcVersion: number,
): {
  readonly totalGroundFloorArea: number;
  readonly totalGroundFloorFrameCost: number;
  readonly totalFirstFloorArea: number;
  readonly totalFirstFloorFrameCost: number;
  readonly totalFrameCost: number;
} {
  const totalGroundFloorArea = roundCurrency(
    basis.groundFloorSqm
      + basis.alfrescoSqm
      + basis.porchSqm
      + basis.garageSqm
      + basis.grannyFlatSqm,
  );
  const totalGroundFloorFrameCost = roundCurrency(
    totalGroundFloorArea * rates.groundFloorFramePricePerSqm,
  );
  const totalFirstFloorArea = frameFirstFloorAreaSqm(basis, calcVersion);
  const totalFirstFloorFrameCost = roundCurrency(
    totalFirstFloorArea * rates.firstFloorFramePricePerSqm,
  );
  const totalFrameCost = roundCurrency(
    totalGroundFloorFrameCost
      + totalFirstFloorFrameCost
      + area.steel
      + area.installer
      + area.eaves,
  );
  return {
    totalGroundFloorArea,
    totalGroundFloorFrameCost,
    totalFirstFloorArea,
    totalFirstFloorFrameCost,
    totalFrameCost,
  };
}

export function calculateBricks(
  area: Pick<
    OfferAreaCalculator,
    "bricksGroundFloor" | "bricksFirstFloor" | "bricksPillar" | "tieCost"
  >,
  rates: Pick<
    AreaRateConstants,
    "sandRatePerThousandBricks" | "cementRatePerHundredBricks"
  >,
): {
  readonly totalBricksRequired: number;
  readonly sandRequiredForBricks: number;
  readonly totalSandCost: number;
  readonly cementRequiredForBricks: number;
  readonly totalCementCost: number;
  readonly totalBrickMaterialCost: number;
} {
  const totalBricksRequired = roundCurrency(
    area.bricksGroundFloor + area.bricksFirstFloor + area.bricksPillar,
  );
  const sandRequiredForBricks = roundCurrency(totalBricksRequired / 1000);
  const totalSandCost = roundCurrency(
    sandRequiredForBricks * rates.sandRatePerThousandBricks,
  );
  const cementRequiredForBricks = roundCurrency(totalBricksRequired / 100);
  const totalCementCost = roundCurrency(
    cementRequiredForBricks * rates.cementRatePerHundredBricks,
  );
  const totalBrickMaterialCost = roundCurrency(
    totalSandCost + totalCementCost + area.tieCost,
  );
  return {
    totalBricksRequired,
    sandRequiredForBricks,
    totalSandCost,
    cementRequiredForBricks,
    totalCementCost,
    totalBrickMaterialCost,
  };
}

type TileOverrideKey = "groundFloorTilesSqm" | "bathroomTilesSqm";

export function calculateTiles(
  basis: Pick<
    OfferAreaBasis,
    | "groundFloorSqm"
    | "alfrescoSqm"
    | "balconySqm"
    | "grannyFlatSqm"
    | "porchSqm"
  >,
  bathrooms: number,
  // The estimator's own tile areas, where entered. Waste and the total are
  // always worked from whichever figure is in force.
  overrides: Pick<OfferAreaCalculator, TileOverrideKey> = {},
): {
  readonly groundFloorTilesSqm: number;
  readonly bathroomTilesSqm: number;
  readonly tilesWasted: number;
  readonly totalTilesRequired: number;
} {
  const groundFloorTilesSqm = roundCurrency(
    overrides.groundFloorTilesSqm
      ?? basis.groundFloorSqm
        + basis.alfrescoSqm
        + basis.balconySqm
        + basis.grannyFlatSqm
        + basis.porchSqm,
  );
  const bathroomTilesSqm = roundCurrency(
    overrides.bathroomTilesSqm ?? bathrooms * 35,
  );
  const baseTiles = roundCurrency(groundFloorTilesSqm + bathroomTilesSqm);
  const tilesWasted = roundCurrency(baseTiles * 0.1);
  const totalTilesRequired = roundCurrency(baseTiles + tilesWasted);
  return {
    groundFloorTilesSqm,
    bathroomTilesSqm,
    tilesWasted,
    totalTilesRequired,
  };
}

export function calculateOfferArea(
  basis: OfferAreaBasis,
  area: OfferAreaCalculator,
  rates: AreaRateConstants,
  // Callers must screen this with isSupportedCalcVersion first; an unrecognised
  // version throws rather than defaulting to rules the offer was not quoted on.
  calcVersion: number,
  bathrooms: number,
): OfferAreaCalculation {
  const slab = calculateSlab(basis, area, rates);
  const frame = calculateFrame(basis, area, rates, calcVersion);
  const bricks = calculateBricks(area, rates);
  const tiles = calculateTiles(basis, bathrooms, area);

  return {
    ...slab,
    ...frame,
    ...bricks,
    ...tiles,
  };
}

// Bathrooms across the whole build: the granny flat's and the second floor's
// counts only while the build has them. The tile areas and the cost formulas
// both price on this.
export function offerTotalBathrooms(
  job: Pick<
    OfferWorkspaceJob,
    | "bathrooms"
    | "hasGrannyHome"
    | "grannyBathrooms"
    | "hasSecondFloor"
    | "secondFloorBathrooms"
  >,
): number {
  return (
    job.bathrooms
    + (job.hasGrannyHome ? job.grannyBathrooms : 0)
    + (job.hasSecondFloor ? job.secondFloorBathrooms : 0)
  );
}

// Bedrooms across the whole build, for TOTAL_BEDROOMS in the cost formulas.
// The granny count is NOT gated on hasGrannyHome: that is how TOTAL_BEDROOMS
// has always been worked, and gating it now would reprice an offer that
// carries granny bedrooms with the toggle off. The second floor is new, so it
// follows its toggle like everything else about it.
export function offerTotalBedrooms(
  job: Pick<
    OfferWorkspaceJob,
    "bedrooms" | "grannyBedrooms" | "hasSecondFloor" | "secondFloorBedrooms"
  >,
): number {
  return (
    job.bedrooms
    + job.grannyBedrooms
    + (job.hasSecondFloor ? job.secondFloorBedrooms : 0)
  );
}

type TileJobInputs = Parameters<typeof offerAreaBasisFromJob>[0]
  & Parameters<typeof offerTotalBathrooms>[0];

// An entered tile area holds only until the figures it replaced move. Once a
// floor area or bathroom count changes the calculated value, the entry is
// dropped and the field follows the calculation again — otherwise a stale
// figure would keep pricing the tiles after the plan changed underneath it.
// Returns `area` itself when nothing needs clearing.
export function reconcileTileOverrides(
  area: OfferAreaCalculator,
  previousJob: TileJobInputs,
  nextJob: TileJobInputs,
): OfferAreaCalculator {
  const before = calculateTiles(
    offerAreaBasisFromJob(previousJob),
    offerTotalBathrooms(previousJob),
  );
  const after = calculateTiles(
    offerAreaBasisFromJob(nextJob),
    offerTotalBathrooms(nextJob),
  );
  const stale = (["groundFloorTilesSqm", "bathroomTilesSqm"] as const).filter(
    (key) => area[key] !== undefined && before[key] !== after[key],
  );
  return stale.length === 0 ? area : withoutTileOverrides(area, stale);
}

// Remove tile overrides by deleting their keys, never by writing undefined:
// the snapshot schema accepts numbers only.
export function withoutTileOverrides(
  area: OfferAreaCalculator,
  keys: readonly TileOverrideKey[],
): OfferAreaCalculator {
  const next: Record<string, number | undefined> = { ...area };
  for (const key of keys) {
    delete next[key];
  }
  return next as OfferAreaCalculator;
}
