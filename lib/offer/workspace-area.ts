import { roundCurrency } from "@/lib/offer/pricing";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";

// The floor-area geometry that feeds the package calculations. This is NOT
// owned here — it is the single source of truth captured in Job setup and
// derived from the job via offerAreaBasisFromJob(). The helper never lets the
// estimator re-type these; that duplication is exactly what drifted before.
export type OfferAreaBasis = {
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly garageSqm: number;
  readonly alfrescoSqm: number;
  readonly porchSqm: number;
  readonly grannyFlatSqm: number;
  readonly balconySqm: number;
};

// The estimator's rate/allowance config plus the secondary measurements the job
// does not capture (lineal metres, tile area). Combined with an OfferAreaBasis
// it produces the slab / frame / brick / tile cost packages.
export type OfferAreaCalculator = {
  readonly slabRatePerSqm: number;
  readonly dropEdgeLinealMeters: number;
  readonly dropEdgeRate: number;
  readonly frameGroundRatePerSqm: number;
  readonly frameFirstRatePerSqm: number;
  readonly steelAllowance: number;
  readonly frameInstallAllowance: number;
  readonly extraTruckCost: number;
  readonly brickGroundLinealMeters: number;
  readonly brickFirstLinealMeters: number;
  readonly brickGroundHeight: number;
  readonly brickFirstHeight: number;
  readonly bricksPerSqm: number;
  readonly sandRatePerThousandBricks: number;
  readonly cementRatePerHundredBricks: number;
  readonly tileAreaSqm: number;
  readonly tileSupplyRatePerSqm: number;
  readonly tilerRatePerSqm: number;
  readonly tileAnglesAllowance: number;
};

export type OfferAreaCalculation = {
  readonly slabAreaSqm: number;
  readonly slabCost: number;
  readonly dropEdgeBeamCost: number;
  readonly slabPackageTotal: number;
  readonly frameGroundFloorCost: number;
  readonly frameFirstFloorCost: number;
  readonly framePackageTotal: number;
  readonly brickGroundSqm: number;
  readonly brickFirstSqm: number;
  readonly brickCount: number;
  readonly brickSandCost: number;
  readonly brickCementCost: number;
  readonly tileSupplyCost: number;
  readonly tilerCost: number;
  readonly tilePackageTotal: number;
  readonly tileWasteThreshold: number;
};

export const EMPTY_AREA_BASIS: OfferAreaBasis = {
  groundFloorSqm: 0,
  firstFloorSqm: 0,
  garageSqm: 0,
  alfrescoSqm: 0,
  porchSqm: 0,
  grannyFlatSqm: 0,
  balconySqm: 0,
};

// Fresh-offer defaults: the RATES and standard allowances remain as estimator
// config so the helper produces real numbers once the job floor areas and the
// secondary measurements are entered/imported.
export const INITIAL_AREA_CALCULATOR: OfferAreaCalculator = {
  slabRatePerSqm: 220,
  dropEdgeLinealMeters: 0,
  dropEdgeRate: 280,
  frameGroundRatePerSqm: 125,
  frameFirstRatePerSqm: 135,
  steelAllowance: 10000,
  frameInstallAllowance: 15000,
  extraTruckCost: 0,
  brickGroundLinealMeters: 0,
  brickFirstLinealMeters: 0,
  brickGroundHeight: 3,
  brickFirstHeight: 3.3,
  bricksPerSqm: 50,
  sandRatePerThousandBricks: 100,
  cementRatePerHundredBricks: 15,
  tileAreaSqm: 0,
  tileSupplyRatePerSqm: 30,
  tilerRatePerSqm: 70,
  tileAnglesAllowance: 0,
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
  };
}

export function getAreaBasisTotalSqm(basis: OfferAreaBasis): number {
  return roundCurrency(
    basis.groundFloorSqm +
    basis.firstFloorSqm +
    basis.alfrescoSqm +
    basis.porchSqm +
    basis.garageSqm +
    basis.grannyFlatSqm,
  );
}

export function calculateOfferArea(
  basis: OfferAreaBasis,
  area: OfferAreaCalculator,
): OfferAreaCalculation {
  const slabAreaSqm = roundCurrency(
    basis.groundFloorSqm +
    basis.alfrescoSqm +
    basis.porchSqm +
    basis.garageSqm +
    basis.grannyFlatSqm,
  );
  const slabCost = roundCurrency(slabAreaSqm * area.slabRatePerSqm);
  const dropEdgeBeamCost = roundCurrency(
    area.dropEdgeLinealMeters * area.dropEdgeRate,
  );
  const slabPackageTotal = roundCurrency(
    slabCost + dropEdgeBeamCost + area.extraTruckCost,
  );
  const frameGroundFloorCost = roundCurrency(
    slabAreaSqm * area.frameGroundRatePerSqm,
  );
  const frameFirstFloorCost = roundCurrency(
    basis.firstFloorSqm * area.frameFirstRatePerSqm,
  );
  const framePackageTotal = roundCurrency(
    frameGroundFloorCost +
    frameFirstFloorCost +
    area.steelAllowance +
    area.frameInstallAllowance,
  );
  const brickGroundSqm = roundCurrency(
    area.brickGroundLinealMeters * area.brickGroundHeight,
  );
  const brickFirstSqm = roundCurrency(
    area.brickFirstLinealMeters * area.brickFirstHeight,
  );
  const brickCount = roundCurrency(
    (brickGroundSqm + brickFirstSqm) * area.bricksPerSqm,
  );
  const brickSandCost = roundCurrency(
    (brickCount / 1000) * area.sandRatePerThousandBricks,
  );
  const brickCementCost = roundCurrency(
    (brickCount / 100) * area.cementRatePerHundredBricks,
  );
  const tileWasteThreshold = roundCurrency(area.tileAreaSqm * 0.10);
  const tileSupplyCost = roundCurrency(
    (area.tileAreaSqm + tileWasteThreshold) * area.tileSupplyRatePerSqm,
  );
  const tilerCost = roundCurrency(area.tileAreaSqm * area.tilerRatePerSqm);

  return {
    slabAreaSqm,
    slabCost,
    dropEdgeBeamCost,
    slabPackageTotal,
    frameGroundFloorCost,
    frameFirstFloorCost,
    framePackageTotal,
    brickGroundSqm,
    brickFirstSqm,
    brickCount,
    brickSandCost,
    brickCementCost,
    tileSupplyCost,
    tileWasteThreshold,
    tilerCost,
    tilePackageTotal: roundCurrency(
      tileSupplyCost + tilerCost + area.tileAnglesAllowance,
    ),
  };
}
