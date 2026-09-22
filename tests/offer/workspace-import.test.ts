import assert from "node:assert/strict";
import { test } from "vitest";
import { parseRoyalQuoteWorkbook } from "@/lib/offer/workspace-import";
import { loadExcelJs } from "@/lib/spreadsheet/exceljs-loader";
import type { WorkbookGrid } from "@/lib/spreadsheet/workbook-grid";
import { readWorkbookGrid } from "@/lib/spreadsheet/workbook-grid";

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

test("imports a SAMPLE QUOTE workbook", async () => {
  const workbook = await buildWorkbookGrid([
    { name: "SAMPLE QUOTE", rows: sampleQuoteRows },
    { name: "costing report", rows: costingRows },
    { name: "area ", rows: areaRows },
  ]);

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
  assert.deepEqual(result.workspacePricingSettings, {
    royalConstructionFeePct: 0.16,
    royalConstructionOverheadPct: 0,
    gstRate: 0.1,
    hbcfTotalContractValue: 733875.88,
    hbcfRate: 0.00966,
    homeWarrantyHbcfFixed: 8500,
    impactFeeFixed: 0,
    loadingChargePercentage: 0,
  });
  assert.equal(result.areaBasis.groundFloorSqm, 110);
  assert.equal(result.areaBasis.firstFloorSqm, 90);
  assert.equal(result.areaCalculator.slabCost, 31020);
  assert.equal(result.areaCalculator.steel, 10000);
  assert.equal(result.areaCalculator.installer, 15000);
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
});

const v2QuoteRows = makeRows(160);
v2QuoteRows[3] = [
  "Stage / Item",
  "Trade / Vendor",
  "Notes / Spec",
  "Unit Cost",
  "Cost (ex-GST)",
  "Comments",
];
v2QuoteRows[4][0] = "A - GENERAL REQUIREMENTS";
v2QuoteRows[5][0] = "Plans & Specifications";
v2QuoteRows[5][1] = "Architect";
v2QuoteRows[5][2] = "CAS project plans";
v2QuoteRows[5][4] = 12000;
v2QuoteRows[16][0] = "B - SITE PREPARATION";
v2QuoteRows[17][0] = "Site clearing";
v2QuoteRows[17][1] = "Excavator";
v2QuoteRows[17][4] = 4500;
v2QuoteRows[142][4] = 16500;

const v2CoverRows = makeRows(40);
v2CoverRows[17][1] = 202.2;
v2CoverRows[18][1] = 170.35;
v2CoverRows[19][1] = 0;
v2CoverRows[20][1] = 27.5;
v2CoverRows[21][1] = 8.5;

const v2SettingsRows = makeRows(12);
v2SettingsRows[3][1] = 0.18;
v2SettingsRows[4][1] = 0.12;
v2SettingsRows[5][1] = 0.1;
v2SettingsRows[6][1] = 0.014;
v2SettingsRows[7][1] = 6000;
v2SettingsRows[8][1] = 12000;
v2SettingsRows[9][1] = 0.03;

test("imports a v2 QUOTE workbook", async () => {
  const v2Workbook = await buildWorkbookGrid([
    { name: "COVER", rows: v2CoverRows },
    { name: "QUOTE", rows: v2QuoteRows },
    { name: "SETTINGS", rows: v2SettingsRows },
  ]);

  const v2Result = parseRoyalQuoteWorkbook(
    v2Workbook,
    "quote template v2.xlsx",
  );

  assert.deepEqual(
    v2Result.costLines.map((line) => ({
      itemName: line.itemName,
      stageCode: line.stageCode,
      tradeOrVendor: line.tradeOrVendor,
      costExGst: line.costExGst,
      sourceReference: line.sourceReference,
    })),
    [
      {
        itemName: "Plans & Specifications",
        stageCode: "A",
        tradeOrVendor: "Architect",
        costExGst: 12000,
        sourceReference: "QUOTE!E6",
      },
      {
        itemName: "Site clearing",
        stageCode: "B",
        tradeOrVendor: "Excavator",
        costExGst: 4500,
        sourceReference: "QUOTE!E18",
      },
    ],
  );
  assert.deepEqual(v2Result.workspacePricingSettings, {
    royalConstructionFeePct: 0.18,
    royalConstructionOverheadPct: 0,
    gstRate: 0.1,
    hbcfTotalContractValue: 0,
    hbcfRate: 0.014,
    homeWarrantyHbcfFixed: 0,
    impactFeeFixed: 0,
    loadingChargePercentage: 0,
  });
  assert.equal(v2Result.areaBasis.groundFloorSqm, 202.2);
  assert.equal(v2Result.areaBasis.firstFloorSqm, 170.35);
  assert.equal(v2Result.areaBasis.alfrescoSqm, 27.5);
  assert.equal(v2Result.areaBasis.porchSqm, 8.5);
  assert.deepEqual(v2Result.validationMessages, []);
});

/**
 * Write the fixture rows out as a real .xlsx and read them back through the
 * production reader, so these tests cover the ExcelJS adapter — cell/row index
 * alignment, error unwrapping and all — and not just the parsing rules.
 */
async function buildWorkbookGrid(
  sheets: readonly { readonly name: string; readonly rows: unknown[][] }[],
): Promise<WorkbookGrid> {
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  for (const sheet of sheets) {
    workbook
      .addWorksheet(sheet.name)
      .addRows(sheet.rows.map((row) => [...row]));
  }

  return readWorkbookGrid(await workbook.xlsx.writeBuffer());
}

function makeRows(count: number): unknown[][] {
  return Array.from({ length: count }, () =>
    Array.from({ length: 30 }, () => ""),
  );
}
