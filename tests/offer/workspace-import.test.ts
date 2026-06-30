import assert from "node:assert/strict";
import { utils } from "xlsx";
import { parseRoyalQuoteWorkbook } from "../../lib/offer/workspace-import";

const sampleQuoteRows = makeRows(90);
sampleQuoteRows[5][3] = "Plans";
sampleQuoteRows[5][4] = "Designer";
sampleQuoteRows[5][5] = "Concept plans";
sampleQuoteRows[5][7] = 5500;
sampleQuoteRows[15][3] = "SLAB";
sampleQuoteRows[15][4] = "Concreter";
sampleQuoteRows[15][6] = "Piering allowance";
sampleQuoteRows[15][7] = 40500;
sampleQuoteRows[79][7] = 405560;
sampleQuoteRows[80][7] = 0;
sampleQuoteRows[81][6] = "Royal Construction Fee 20%";
sampleQuoteRows[81][7] = 64889.6;
sampleQuoteRows[82][7] = 8500;
sampleQuoteRows[82][9] = "#REF!";
sampleQuoteRows[84][7] = 5000;
sampleQuoteRows[85][7] = 8000;
sampleQuoteRows[86][7] = 40000;

const costingRows = makeRows(195);
costingRows[3] = [
  "Quote",
  "Actual",
  "Difference",
  "Comments and References",
  "INVOICE NO",
  "TRADES",
  "COST EXCLUDE GST",
  "GST 10%",
  "COST INCLUDED GST",
  "TOTAL COST INCLUDING GST",
];
costingRows[191][0] = "PAYMENTS";

const areaRows = makeRows(40);
areaRows[2][2] = 110;
areaRows[2][5] = 90;
areaRows[3][2] = 8;
areaRows[4][2] = 3;
areaRows[5][2] = 20;
areaRows[6][2] = 0;
areaRows[7][2] = 141;
areaRows[9][2] = 31020;
areaRows[10][1] = 280;
areaRows[10][2] = 2800;
areaRows[9][5] = 17625;
areaRows[10][5] = 12150;
areaRows[11][5] = 10000;
areaRows[12][5] = 15000;
areaRows[34][5] = 212.3;
areaRows[35][5] = 6369;
areaRows[36][5] = 14861;
areaRows[37][5] = 0;

const workbook = utils.book_new();
utils.book_append_sheet(
  workbook,
  utils.aoa_to_sheet(sampleQuoteRows),
  "SAMPLE QUOTE",
);
utils.book_append_sheet(
  workbook,
  utils.aoa_to_sheet(costingRows),
  "costing report",
);
utils.book_append_sheet(workbook, utils.aoa_to_sheet(areaRows), "area ");

const result = parseRoyalQuoteWorkbook(workbook, "test workbook.xlsx");

assert.equal(result.sourceName, "test workbook.xlsx");
assert.deepEqual(
  result.costLines.map((line) => ({
    itemName: line.itemName,
    stageCode: line.stageCode,
    costExGst: line.costExGst,
    sourceReference: line.sourceReference,
  })),
  [
    {
      itemName: "Plans",
      stageCode: "A",
      costExGst: 5500,
      sourceReference: "SAMPLE QUOTE!H6",
    },
    {
      itemName: "SLAB",
      stageCode: "C",
      costExGst: 40500,
      sourceReference: "SAMPLE QUOTE!H16",
    },
  ],
);
assert.deepEqual(result.legacyPricingSettings, {
  overheadPct: 0,
  royalConstructionFeePct: 0.16,
  hbcfInsuranceFixed: 8500,
  adminCostFixed: 5000,
  labourCostFixed: 8000,
  otherAdjustmentFixed: 40000,
});
assert.equal(result.areaCalculator.groundFloorSqm, 110);
assert.equal(result.areaCalculator.firstFloorSqm, 90);
assert.equal(result.areaCalculator.slabRatePerSqm, 220);
assert.equal(result.areaCalculator.dropEdgeLinealMeters, 10);
assert.ok(
  result.validationMessages.some((message) =>
    message.includes("SAMPLE QUOTE J83 has #REF!"),
  ),
);
assert.ok(
  result.validationMessages.some((message) =>
    message.includes("label says 20% but workbook formula implies 16%"),
  ),
);
assert.deepEqual(result.ignoredProjectFields, [
  "Actual",
  "Difference",
  "Comments and References",
  "INVOICE NO",
  "TRADES",
  "COST EXCLUDE GST",
  "GST 10%",
  "COST INCLUDED GST",
  "TOTAL COST INCLUDING GST",
  "PAYMENTS",
]);

function makeRows(count: number): unknown[][] {
  return Array.from({ length: count }, () => []);
}
