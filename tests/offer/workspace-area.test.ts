import assert from "node:assert/strict";
import { test } from "vitest";

import {
  calculateSlab,
  calculateFrame,
  calculateBricks,
  calculateTiles,
  calculateOfferArea,
  getAreaBasisTotalSqm,
  INITIAL_AREA_CALCULATOR,
  offerTotalBathrooms,
  reconcileTileOverrides,
  withoutTileOverrides,
  type OfferAreaBasis,
  type OfferAreaCalculator,
  type AreaRateConstants,
} from "@/lib/offer/workspace-area";
import {
  CURRENT_CALC_VERSION,
  LEGACY_CALC_VERSION,
} from "@/lib/offer/workspace-persistence";

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

test("the slab total carries the drop-edge-beam and truck costs", () => {
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
      // slabCost + totalDropEdgeBeamCost + totalTruckPrice = 28200 + 900 + 1500.
      // The hand-updated expectation in 5ddded4 dropped the drop-edge-beam term.
      totalSlabCost: 30600,
      slabCost: 28200,
    },
  );
});

test("zero/empty slab inputs still price the slab off the area", () => {
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
});

// ─── calculateFrame ───

test("the frame splits ground and first floor at their own rates", () => {
  assert.deepEqual(
    calculateFrame(
      basis,
      { steel: 10000, installer: 15000, eaves: 5000 },
      {
        groundFloorFramePricePerSqm: 137.5,
        firstFloorFramePricePerSqm: 148.5,
      },
      LEGACY_CALC_VERSION,
    ),
    {
      totalGroundFloorArea: 141,
      totalGroundFloorFrameCost: 19387.5,
      totalFirstFloorArea: 90,
      totalFirstFloorFrameCost: 13365,
      totalFrameCost: 62752.5,
    },
  );
});

test("zero/empty frame inputs are zero, not NaN", () => {
  assert.deepEqual(
    calculateFrame(
      {
        ...basis,
        groundFloorSqm: 0,
        firstFloorSqm: 0,
        alfrescoSqm: 0,
        porchSqm: 0,
        garageSqm: 0,
        grannyFlatSqm: 0,
        balconySqm: 0,
      },
      { steel: 0, installer: 0, eaves: 0 },
      {
        groundFloorFramePricePerSqm: 137.5,
        firstFloorFramePricePerSqm: 148.5,
      },
      LEGACY_CALC_VERSION,
    ),
    {
      totalGroundFloorArea: 0,
      totalGroundFloorFrameCost: 0,
      totalFirstFloorArea: 0,
      totalFirstFloorFrameCost: 0,
      totalFrameCost: 0,
    },
  );
});

// ─── calculateBricks ───

test("bricks drive the sand and cement they need", () => {
  assert.deepEqual(
    calculateBricks(
      {
        bricksGroundFloor: 10000,
        bricksFirstFloor: 5000,
        bricksPillar: 500,
        tieCost: 200,
      },
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
});

test("zero/empty brick inputs are zero, not NaN", () => {
  assert.deepEqual(
    calculateBricks(
      {
        bricksGroundFloor: 0,
        bricksFirstFloor: 0,
        bricksPillar: 0,
        tieCost: 0,
      },
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
});

// ─── calculateTiles ───

test("tiles cover the wet areas plus a waste allowance", () => {
  assert.deepEqual(
    calculateTiles(
      {
        groundFloorSqm: 110,
        alfrescoSqm: 8,
        balconySqm: 6,
        grannyFlatSqm: 12,
        porchSqm: 3,
      },
      2,
    ),
    {
      groundFloorTilesSqm: 139,
      bathroomTilesSqm: 70,
      tilesWasted: 20.9,
      totalTilesRequired: 229.9,
    },
  );
});

test("zero/empty tile inputs are zero, not NaN", () => {
  assert.deepEqual(
    calculateTiles(
      {
        groundFloorSqm: 0,
        alfrescoSqm: 0,
        balconySqm: 0,
        grannyFlatSqm: 0,
        porchSqm: 0,
      },
      0,
    ),
    {
      groundFloorTilesSqm: 0,
      bathroomTilesSqm: 0,
      tilesWasted: 0,
      totalTilesRequired: 0,
    },
  );
});

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
};

test("the combined calculator agrees with each part it is built from", () => {
  const calc = calculateOfferArea(
    basis,
    area,
    defaultRates,
    LEGACY_CALC_VERSION,
    2,
  );
  assert.equal(calc.totalSlabCost, 30600); // 28200 slab + 900 drop edge beam + 1500 trucks
  assert.equal(calc.totalDropEdgeBeamCost, 900);
  assert.equal(calc.totalTruckPrice, 1500);
  assert.equal(calc.totalGroundFloorArea, 141);
  assert.equal(calc.totalGroundFloorFrameCost, 19387.5);
  assert.equal(calc.totalFirstFloorArea, 90);
  assert.equal(calc.totalFirstFloorFrameCost, 13365);
  assert.equal(calc.totalFrameCost, 62752.5);
  assert.equal(calc.totalBricksRequired, 15500);
  assert.equal(calc.totalBrickMaterialCost, 4075);
  assert.equal(calc.groundFloorTilesSqm, 121);
  assert.equal(calc.bathroomTilesSqm, 70);
  assert.equal(calc.tilesWasted, 19.1);
  assert.equal(calc.totalTilesRequired, 210.1);
});

test("an all-zero calculator still prices what the rates alone decide", () => {
  const zeroCalc = calculateOfferArea(
    basis,
    INITIAL_AREA_CALCULATOR,
    defaultRates,
    LEGACY_CALC_VERSION,
    0,
  );
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
  assert.equal(zeroCalc.groundFloorTilesSqm, 121);
  assert.equal(zeroCalc.bathroomTilesSqm, 0);
  assert.equal(zeroCalc.tilesWasted, 12.1);
  assert.equal(zeroCalc.totalTilesRequired, 133.1);
});

// ─── getAreaBasisTotalSqm ───

test("the basis total sums every area it is given", () => {
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
});

// ─── The calculation pin (v1 vs v2) ───
//
// v1 is the historical record for every offer minted before the pin. v2 adds the
// void to the first-floor frame area. These assertions are the guarantee the
// owner was given: an existing offer's frame numbers cannot move.

const pinBasis = { ...basis, firstFloorSqm: 80, balconySqm: 10, voidSqm: 12 };
const pinRates = {
  groundFloorFramePricePerSqm: 137.5,
  firstFloorFramePricePerSqm: 148.5,
};
const pinInputs = { steel: 0, installer: 0, eaves: 0 };

test("v1 ignores the void entirely, so a pre-pin offer cannot move", () => {
  const v1 = calculateFrame(pinBasis, pinInputs, pinRates, LEGACY_CALC_VERSION);
  // 80 + 10.
  assert.equal(v1.totalFirstFloorArea, 90);
  assert.equal(v1.totalFirstFloorFrameCost, 13365);
});

test("v2 counts the void into the first-floor frame area", () => {
  const v2 = calculateFrame(
    pinBasis,
    pinInputs,
    pinRates,
    CURRENT_CALC_VERSION,
  );
  // 80 + 10 + 12.
  assert.equal(v2.totalFirstFloorArea, 102);
  assert.equal(v2.totalFirstFloorFrameCost, 15147);
});

test("a build with no void prices identically under both rules", () => {
  // Which is why only void-bearing offers are affected at all.
  const noVoid = { ...pinBasis, voidSqm: 0 };
  assert.deepEqual(
    calculateFrame(noVoid, pinInputs, pinRates, LEGACY_CALC_VERSION),
    calculateFrame(noVoid, pinInputs, pinRates, CURRENT_CALC_VERSION),
  );
});

test("an unknown calculation version fails loudly rather than falling back", () => {
  assert.throws(
    () => calculateFrame(pinBasis, pinInputs, pinRates, 99 as never),
    /calculation rules v99/,
  );
});

// ─── Entered tile areas ───

const TILE_BASIS = {
  groundFloorSqm: 110,
  alfrescoSqm: 8,
  balconySqm: 6,
  grannyFlatSqm: 12,
  porchSqm: 3,
};

test("an entered tile area replaces the calculated one, and waste follows it", () => {
  assert.deepEqual(
    calculateTiles(TILE_BASIS, 2, {
      groundFloorTilesSqm: 120,
      bathroomTilesSqm: 50,
    }),
    {
      groundFloorTilesSqm: 120,
      bathroomTilesSqm: 50,
      tilesWasted: 17,
      totalTilesRequired: 187,
    },
  );
});

test("an entered 0 is honoured, not treated as blank", () => {
  assert.equal(
    calculateTiles(TILE_BASIS, 2, { bathroomTilesSqm: 0 }).bathroomTilesSqm,
    0,
  );
});

test("the combined calculation prices tiles on the entered areas", () => {
  const calc = calculateOfferArea(
    basis,
    { ...INITIAL_AREA_CALCULATOR, groundFloorTilesSqm: 100 },
    defaultRates,
    CURRENT_CALC_VERSION,
    0,
  );
  assert.equal(calc.groundFloorTilesSqm, 100);
  assert.equal(calc.totalTilesRequired, 110);
});

const TILE_JOB = {
  groundFloorSqm: 110,
  firstFloorSqm: 90,
  garageSqm: 20,
  alfrescoPorchSqm: 8,
  porchSqm: 3,
  grannyFlatSqm: 0,
  balconySqm: 0,
  voidSqm: 0,
  kitchenSqm: 0,
  bathrooms: 2,
  hasGrannyHome: false,
  grannyBathrooms: 1,
};

test("bathrooms count the granny flat's only while the build has one", () => {
  assert.equal(offerTotalBathrooms(TILE_JOB), 2);
  assert.equal(offerTotalBathrooms({ ...TILE_JOB, hasGrannyHome: true }), 3);
});

test("an entered tile area is dropped once the areas behind it change", () => {
  const area: OfferAreaCalculator = {
    ...INITIAL_AREA_CALCULATOR,
    groundFloorTilesSqm: 150,
    bathroomTilesSqm: 60,
  };
  const next = reconcileTileOverrides(area, TILE_JOB, {
    ...TILE_JOB,
    groundFloorSqm: 120,
  });
  assert.equal("groundFloorTilesSqm" in next, false);
  // The bathroom figure was not worked from the ground floor, so it stays.
  assert.equal(next.bathroomTilesSqm, 60);

  const fewerBathrooms = reconcileTileOverrides(area, TILE_JOB, {
    ...TILE_JOB,
    bathrooms: 1,
  });
  assert.equal("bathroomTilesSqm" in fewerBathrooms, false);
  assert.equal(fewerBathrooms.groundFloorTilesSqm, 150);
});

test("an unrelated job change leaves entered tile areas alone", () => {
  const area: OfferAreaCalculator = {
    ...INITIAL_AREA_CALCULATOR,
    groundFloorTilesSqm: 150,
  };
  // First floor and garage do not feed the tile areas.
  assert.equal(
    reconcileTileOverrides(area, TILE_JOB, {
      ...TILE_JOB,
      firstFloorSqm: 95,
      garageSqm: 40,
    }),
    area,
  );
});

test("clearing a tile area removes its key, since the snapshot holds numbers only", () => {
  const cleared = withoutTileOverrides(
    { ...INITIAL_AREA_CALCULATOR, groundFloorTilesSqm: 150 },
    ["groundFloorTilesSqm"],
  );
  assert.equal("groundFloorTilesSqm" in cleared, false);
  assert.deepEqual(cleared, INITIAL_AREA_CALCULATOR);
});
