import { roundCurrency } from "@/lib/offer/pricing";

export type OfferAreaCalculator = {
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly alfrescoSqm: number;
  readonly porchSqm: number;
  readonly garageSqm: number;
  readonly grannyFlatSqm: number;
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
};

export const INITIAL_AREA_CALCULATOR: OfferAreaCalculator = {
  groundFloorSqm: 138,
  firstFloorSqm: 126,
  alfrescoSqm: 16,
  porchSqm: 8,
  garageSqm: 36,
  grannyFlatSqm: 0,
  slabRatePerSqm: 220,
  dropEdgeLinealMeters: 10,
  dropEdgeRate: 280,
  frameGroundRatePerSqm: 125,
  frameFirstRatePerSqm: 135,
  steelAllowance: 10000,
  frameInstallAllowance: 15000,
  extraTruckCost: 0,
  brickGroundLinealMeters: 76,
  brickFirstLinealMeters: 36,
  brickGroundHeight: 3,
  brickFirstHeight: 3.3,
  bricksPerSqm: 50,
  sandRatePerThousandBricks: 100,
  cementRatePerHundredBricks: 15,
  tileAreaSqm: 212.3,
  tileSupplyRatePerSqm: 30,
  tilerRatePerSqm: 70,
  tileAnglesAllowance: 0,
};

export function getAreaCalculatorTotalSqm(area: OfferAreaCalculator): number {
  return roundCurrency(
    area.groundFloorSqm +
      area.firstFloorSqm +
      area.alfrescoSqm +
      area.porchSqm +
      area.garageSqm +
      area.grannyFlatSqm,
  );
}

export function calculateOfferArea(
  area: OfferAreaCalculator,
): OfferAreaCalculation {
  const slabAreaSqm = roundCurrency(
    area.groundFloorSqm +
      area.alfrescoSqm +
      area.porchSqm +
      area.garageSqm +
      area.grannyFlatSqm,
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
    area.firstFloorSqm * area.frameFirstRatePerSqm,
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
  const tileSupplyCost = roundCurrency(
    area.tileAreaSqm * area.tileSupplyRatePerSqm,
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
    tilerCost,
    tilePackageTotal: roundCurrency(
      tileSupplyCost + tilerCost + area.tileAnglesAllowance,
    ),
  };
}
