import assert from "node:assert/strict";
import {
  calculateSlab,
  calculateFrame,
  calculateBricks,
  calculateTiles,
  calculateOfferArea,
  getAreaBasisTotalSqm,
  INITIAL_AREA_CALCULATOR,
  type OfferAreaBasis,
  type OfferAreaCalculator,
  type AreaRateConstants,
} from "../../lib/offer/workspace-area";

const basis: OfferAreaBasis = {
  groundFloorSqm: 110,
  firstFloorSqm: 90,
  alfrescoSqm: 8,
  porchSqm: 3,
  garageSqm: 20,
  grannyFlatSqm: 0,
  balconySqm: 0,
  voidSqm: 0,
  kitchenSqm: 0,
};

const defaultRates: AreaRateConstants = {
  dropEdgeBeamCostPerSurfaceArea: 18,
  priceOfEachTruck: 500,
  groundFloorFramePricePerSqm: 137.5,
  firstFloorFramePricePerSqm: 148.5,
  sandRatePerThousandBricks: 100,
  cementRatePerHundredBricks: 15,
  brickPricePerBrick: 0,
  brickLayingPricePerBrick: 0,
  tilePricePerTile: 0,
  tilingRatePerSqm: 0,
  flooringRatePerSqm: 0,
  slabCostPerSqm: 200,
};

// ─── calculateSlab ───
assert.deepEqual(
  calculateSlab(
    basis,
    { slabCost: 30000, dropEdgeBeamSurfaceArea: 50, numberOfTrucks: 3 },
    {
      dropEdgeBeamCostPerSurfaceArea: 18,
      priceOfEachTruck: 500,
      slabCostPerSqm: 200,
    },
  ),
  {
    totalDropEdgeBeamCost: 900,
    totalTruckPrice: 1500,
    totalSlabCost: 29700,
    slabCost: 28200,
  },
);

// Zero/empty slab inputs
assert.deepEqual(
  calculateSlab(
    basis,
    { slabCost: 0, dropEdgeBeamSurfaceArea: 0, numberOfTrucks: 0 },
    {
      dropEdgeBeamCostPerSurfaceArea: 18,
      priceOfEachTruck: 500,
      slabCostPerSqm: 200,
    },
  ),
  {
    totalDropEdgeBeamCost: 0,
    totalTruckPrice: 0,
    totalSlabCost: 28200,
    slabCost: 28200,
  },
);
// ─── calculateFrame ───

assert.deepEqual(
  calculateFrame(
    basis,
    { steel: 10000, installer: 15000, eaves: 5000 },
    {
      groundFloorFramePricePerSqm: 137.5,
      firstFloorFramePricePerSqm: 148.5,
    },
  ),
  {
    totalGroundFloorArea: 141,
    totalGroundFloorFrameCost: 19387.5,
    totalFirstFloorArea: 90,
    totalFirstFloorFrameCost: 13365,
    totalFrameCost: 62752.5,
  },
);

// Zero/empty frame inputs
assert.deepEqual(
  calculateFrame(
    { ...basis, groundFloorSqm: 0, firstFloorSqm: 0, alfrescoSqm: 0, porchSqm: 0, garageSqm: 0, grannyFlatSqm: 0, balconySqm: 0 },
    { steel: 0, installer: 0, eaves: 0 },
    {
      groundFloorFramePricePerSqm: 137.5,
      firstFloorFramePricePerSqm: 148.5,
    },
  ),
  {
    totalGroundFloorArea: 0,
    totalGroundFloorFrameCost: 0,
    totalFirstFloorArea: 0,
    totalFirstFloorFrameCost: 0,
    totalFrameCost: 0,
  },
);

// ─── calculateBricks ───

assert.deepEqual(
  calculateBricks(
    { bricksGroundFloor: 10000, bricksFirstFloor: 5000, bricksPillar: 500, tieCost: 200 },
    {
      sandRatePerThousandBricks: 100,
      cementRatePerHundredBricks: 15,
    },
  ),
  {
    totalBricksRequired: 15500,
    sandRequiredForBricks: 15.5,
    totalSandCost: 1550,
    cementRequiredForBricks: 155,
    totalCementCost: 2325,
    totalBrickMaterialCost: 4075,
  },
);

// Zero/empty brick inputs
assert.deepEqual(
  calculateBricks(
    { bricksGroundFloor: 0, bricksFirstFloor: 0, bricksPillar: 0, tieCost: 0 },
    {
      sandRatePerThousandBricks: 100,
      cementRatePerHundredBricks: 15,
    },
  ),
  {
    totalBricksRequired: 0,
    sandRequiredForBricks: 0,
    totalSandCost: 0,
    cementRequiredForBricks: 0,
    totalCementCost: 0,
    totalBrickMaterialCost: 0,
  },
);

// ─── calculateTiles ───

assert.deepEqual(
  calculateTiles({ tilesGroundFloor: 1000, tilesBathroom: 200, tilesSteps: 50 }),
  {
    tilesWasted: 125,
    totalTilesRequired: 1375,
  },
);

// Zero/empty tile inputs
assert.deepEqual(
  calculateTiles({ tilesGroundFloor: 0, tilesBathroom: 0, tilesSteps: 0 }),
  {
    tilesWasted: 0,
    totalTilesRequired: 0,
  },
);

// ─── calculateOfferArea (combined) ───

const area: OfferAreaCalculator = {
  slabCost: 30000,
  dropEdgeBeamSurfaceArea: 50,
  numberOfTrucks: 3,
  steel: 10000,
  installer: 15000,
  eaves: 5000,
  bricksGroundFloor: 10000,
  bricksFirstFloor: 5000,
  bricksPillar: 500,
  tieCost: 200,
  tilesGroundFloor: 1000,
  tilesBathroom: 200,
  tilesSteps: 50,
};

const calc = calculateOfferArea(basis, area, defaultRates);
assert.equal(calc.totalSlabCost, 29700);
assert.equal(calc.totalDropEdgeBeamCost, 900);
assert.equal(calc.totalTruckPrice, 1500);
assert.equal(calc.totalGroundFloorArea, 141);
assert.equal(calc.totalGroundFloorFrameCost, 19387.5);
assert.equal(calc.totalFirstFloorArea, 90);
assert.equal(calc.totalFirstFloorFrameCost, 13365);
assert.equal(calc.totalFrameCost, 62752.5);
assert.equal(calc.totalBricksRequired, 15500);
assert.equal(calc.totalBrickMaterialCost, 4075);
assert.equal(calc.tilesWasted, 125);
assert.equal(calc.totalTilesRequired, 1375);

// ─── All-zero calculator with defaults ───

const zeroCalc = calculateOfferArea(basis, INITIAL_AREA_CALCULATOR, defaultRates);
assert.equal(zeroCalc.totalSlabCost, 28200);
assert.equal(zeroCalc.totalDropEdgeBeamCost, 0);
assert.equal(zeroCalc.totalTruckPrice, 0);
assert.equal(zeroCalc.totalGroundFloorArea, 141);
assert.equal(zeroCalc.totalGroundFloorFrameCost, 19387.5);
assert.equal(zeroCalc.totalFirstFloorArea, 90);
assert.equal(zeroCalc.totalFirstFloorFrameCost, 13365);
assert.equal(zeroCalc.totalFrameCost, 32752.5);
assert.equal(zeroCalc.totalBricksRequired, 0);
assert.equal(zeroCalc.totalBrickMaterialCost, 0);
assert.equal(zeroCalc.tilesWasted, 0);
assert.equal(zeroCalc.totalTilesRequired, 0);

// ─── getAreaBasisTotalSqm ───

assert.equal(getAreaBasisTotalSqm(basis), 231);
assert.equal(
  getAreaBasisTotalSqm({
    groundFloorSqm: 0,
    firstFloorSqm: 0,
    garageSqm: 0,
    alfrescoSqm: 0,
    porchSqm: 0,
    grannyFlatSqm: 0,
    balconySqm: 0,
    voidSqm: 0,
    kitchenSqm: 0,
  }),
  0,
);
