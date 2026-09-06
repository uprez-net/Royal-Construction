import { roundCurrency } from "@/lib/offer/pricing";
import {
  CURRENT_CALC_VERSION,
  LEGACY_CALC_VERSION,
  type CalcVersion,
} from "@/lib/offer/workspace-persistence";
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
  readonly tilesGroundFloor: number;
  readonly tilesBathroom: number;
  readonly tilesSteps: number;
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
  // ── Tiles ──
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
  tilesGroundFloor: 0,
  tilesBathroom: 0,
  tilesSteps: 0,
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
    basis.groundFloorSqm +
    basis.firstFloorSqm +
    basis.garageSqm +
    basis.alfrescoSqm +
    basis.porchSqm +
    basis.grannyFlatSqm +
    basis.balconySqm +
    basis.voidSqm
  );
}

export function getAreaBasisTotalSqm(basis: OfferAreaBasis): number {
  return roundCurrency(
    basis.groundFloorSqm +
    basis.firstFloorSqm +
    basis.alfrescoSqm +
    basis.porchSqm +
    basis.garageSqm +
    basis.voidSqm +
    basis.grannyFlatSqm +
    basis.balconySqm,
  );
}

// ─── Pure per-section calculation functions (unit-testable) ───

export function calculateSlab(
  basis: OfferAreaBasis,
  area: Pick<OfferAreaCalculator, "slabCost" | "dropEdgeBeamSurfaceArea" | "numberOfTrucks">,
  rates: Pick<AreaRateConstants, "dropEdgeBeamCostPerSurfaceArea" | "priceOfEachTruck" | "slabCostPerSqm">,
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
    (basis.groundFloorSqm + basis.alfrescoSqm + basis.porchSqm + basis.garageSqm + basis.grannyFlatSqm) * rates.slabCostPerSqm
  );
  const totalSlabCost = roundCurrency(
    slabCost + totalDropEdgeBeamCost + totalTruckPrice,
  );
  return { totalDropEdgeBeamCost, totalTruckPrice, totalSlabCost, slabCost };
}

// Thrown when an offer names calculation rules this build does not carry — a
// rollback past a newer version. Deliberately loud and local: callers render the
// workspace read-only rather than silently falling back to legacy maths, which
// would reprice the offer.
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
  calcVersion: CalcVersion,
): number {
  switch (calcVersion) {
    case LEGACY_CALC_VERSION:
      return roundCurrency(basis.firstFloorSqm + basis.balconySqm);
    case CURRENT_CALC_VERSION:
      // A void is a hole in the first floor, but the frame still spans it.
      return roundCurrency(
        basis.firstFloorSqm + basis.balconySqm + basis.voidSqm,
      );
    default:
      throw new UnsupportedCalcVersionError(calcVersion);
  }
}

export function calculateFrame(
  basis: OfferAreaBasis,
  area: Pick<OfferAreaCalculator, "steel" | "installer" | "eaves">,
  rates: Pick<AreaRateConstants, "groundFloorFramePricePerSqm" | "firstFloorFramePricePerSqm">,
  calcVersion: CalcVersion,
): {
  readonly totalGroundFloorArea: number;
  readonly totalGroundFloorFrameCost: number;
  readonly totalFirstFloorArea: number;
  readonly totalFirstFloorFrameCost: number;
  readonly totalFrameCost: number;
} {
  const totalGroundFloorArea = roundCurrency(
    basis.groundFloorSqm +
    basis.alfrescoSqm +
    basis.porchSqm +
    basis.garageSqm +
    basis.grannyFlatSqm,
  );
  const totalGroundFloorFrameCost = roundCurrency(
    totalGroundFloorArea * rates.groundFloorFramePricePerSqm,
  );
  const totalFirstFloorArea = frameFirstFloorAreaSqm(basis, calcVersion);
  const totalFirstFloorFrameCost = roundCurrency(
    totalFirstFloorArea * rates.firstFloorFramePricePerSqm,
  );
  const totalFrameCost = roundCurrency(
    totalGroundFloorFrameCost +
    totalFirstFloorFrameCost +
    area.steel +
    area.installer +
    area.eaves,
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
  area: Pick<OfferAreaCalculator, "bricksGroundFloor" | "bricksFirstFloor" | "bricksPillar" | "tieCost">,
  rates: Pick<AreaRateConstants, "sandRatePerThousandBricks" | "cementRatePerHundredBricks">,
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

export function calculateTiles(
  area: Pick<OfferAreaCalculator, "tilesGroundFloor" | "tilesBathroom" | "tilesSteps">,
): {
  readonly tilesWasted: number;
  readonly totalTilesRequired: number;
} {
  const baseTiles = roundCurrency(
    area.tilesGroundFloor + area.tilesBathroom + area.tilesSteps,
  );
  const tilesWasted = roundCurrency(baseTiles * 0.10);
  const totalTilesRequired = roundCurrency(baseTiles + tilesWasted);
  return { tilesWasted, totalTilesRequired };
}

export function calculateOfferArea(
  basis: OfferAreaBasis,
  area: OfferAreaCalculator,
  rates: AreaRateConstants,
  calcVersion: CalcVersion,
): OfferAreaCalculation {
  const slab = calculateSlab(basis, area, rates);
  const frame = calculateFrame(basis, area, rates, calcVersion);
  const bricks = calculateBricks(area, rates);
  const tiles = calculateTiles(area);

  return {
    ...slab,
    ...frame,
    ...bricks,
    ...tiles,
  };
}
