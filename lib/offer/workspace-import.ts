import type { WorkBook, WorkSheet } from "xlsx";
import { utils } from "xlsx";
import type { OfferAreaCalculator } from "@/lib/offer/workspace-area";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import {
  DEFAULT_LEGACY_PRICING_SETTINGS,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  OFFER_STAGE_CATALOG,
  applyTaskMappingToCostLine,
  type OfferStageCode,
} from "@/lib/offer/workspace-model";
import type {
  LegacyWorkbookPricingSettings,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";

export type OfferWorkbookImportResult = {
  readonly sourceName: string;
  readonly costLines: readonly OfferWorkspaceCostLine[];
  readonly areaCalculator: OfferAreaCalculator;
  readonly workspacePricingSettings: OfferWorkspacePricingSettings;
  readonly legacyPricingSettings: LegacyWorkbookPricingSettings;
  readonly validationMessages: readonly string[];
  readonly ignoredProjectFields: readonly string[];
};

const PROJECT_PHASE_HEADERS = [
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
] as const;

export function parseRoyalQuoteWorkbook(
  workbook: WorkBook,
  sourceName: string,
): OfferWorkbookImportResult {
  const quoteRows = readRows(workbook.Sheets.QUOTE, true);
  const sampleRows = readRows(workbook.Sheets["SAMPLE QUOTE"], true);
  const sampleDisplayRows = readRows(workbook.Sheets["SAMPLE QUOTE"], false);
  const costingDisplayRows = readRows(workbook.Sheets["costing report"], false);
  const areaRows = readRows(workbook.Sheets["area "], true);
  const coverRows = readRows(workbook.Sheets.COVER, true);
  const settingsRows = readRows(workbook.Sheets.SETTINGS, true);
  const costLines =
    quoteRows.length > 0 ? parseV2QuoteRows(quoteRows) : parseSampleQuoteRows(sampleRows);
  const areaCalculator =
    coverRows.length > 0 ? parseCoverArea(coverRows) : parseAreaCalculator(areaRows);
  const formulaErrors = [
    ...findFormulaErrors("SAMPLE QUOTE", sampleDisplayRows),
    ...findFormulaErrors("costing report", costingDisplayRows),
    ...findFormulaErrors("area", readRows(workbook.Sheets["area "], false)),
    ...findFormulaErrors("QUOTE", readRows(workbook.Sheets.QUOTE, false)),
    ...findFormulaErrors("COVER", readRows(workbook.Sheets.COVER, false)),
  ];
  const legacyPricingSettings = parseLegacyPricingSettings(sampleRows);
  const validationMessages = [
    ...formulaErrors,
    ...(sampleRows.length > 0
      ? findLegacyPricingWarnings(sampleRows, legacyPricingSettings)
      : []),
  ];

  return {
    sourceName,
    costLines,
    areaCalculator,
    workspacePricingSettings: parseWorkspacePricingSettings(settingsRows),
    legacyPricingSettings,
    validationMessages,
    ignoredProjectFields: findIgnoredProjectFields(costingDisplayRows),
  };
}

function readRows(
  sheet: WorkSheet | undefined,
  raw: boolean,
): readonly (readonly unknown[])[] {
  if (sheet === undefined) {
    return [];
  }

  return utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw,
    defval: "",
  });
}

function getCell(
  rows: readonly (readonly unknown[])[],
  rowIndex: number,
  columnIndex: number,
): unknown {
  return rows[rowIndex]?.[columnIndex] ?? "";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(values: readonly unknown[], fallback: number): number {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return fallback;
}

function parseSampleQuoteRows(
  rows: readonly (readonly unknown[])[],
): readonly OfferWorkspaceCostLine[] {
  const lines: OfferWorkspaceCostLine[] = [];

  for (let rowIndex = 5; rowIndex < 78; rowIndex += 1) {
    const itemName = textValue(getCell(rows, rowIndex, 3));
    const costExGst = numberValue(getCell(rows, rowIndex, 7));
    if (itemName.length === 0 || costExGst === null || costExGst <= 0) {
      continue;
    }

    const sourceRow = rowIndex + 1;
    const line: OfferWorkspaceCostLine = {
      id: `imported-${sourceRow}-${itemName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      stageCode: inferStageCode(itemName),
      itemName,
      buildingSequenceTasks: [],
      offerTenderLineItem: "",
      tradeOrVendor: textValue(getCell(rows, rowIndex, 4)),
      notesOrSpec: [getCell(rows, rowIndex, 5), getCell(rows, rowIndex, 6)]
        .map(textValue)
        .filter((value) => value.length > 0)
        .join(" / "),
      costExGst,
      includedInContract: true,
      sourceReference: `SAMPLE QUOTE!H${sourceRow}`,
    };

    lines.push(applyTaskMappingToCostLine(line, itemName));
  }

  return lines;
}

function parseV2QuoteRows(
  rows: readonly (readonly unknown[])[],
): readonly OfferWorkspaceCostLine[] {
  const lines: OfferWorkspaceCostLine[] = [];
  let currentStageCode: OfferStageCode = "A";

  rows.forEach((row, rowIndex) => {
    const itemOrStage = textValue(row[0]);
    const detectedStageCode = getStageCodeFromLabel(itemOrStage);
    if (detectedStageCode !== null) {
      currentStageCode = detectedStageCode;
      return;
    }

    const costExGst = numberValue(row[4]);
    if (itemOrStage.length === 0 || costExGst === null || costExGst <= 0) {
      return;
    }

    const sourceRow = rowIndex + 1;
    const line: OfferWorkspaceCostLine = {
      id: `quote-${sourceRow}-${itemOrStage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      stageCode: currentStageCode,
      itemName: itemOrStage,
      buildingSequenceTasks: [],
      offerTenderLineItem: "",
      tradeOrVendor: textValue(row[1]),
      notesOrSpec: [row[2], row[3], row[5]]
        .map(textValue)
        .filter((value) => value.length > 0)
        .join(" / "),
      costExGst,
      includedInContract: true,
      sourceReference: `QUOTE!E${sourceRow}`,
    };

    lines.push(applyTaskMappingToCostLine(line, itemOrStage));
  });

  return lines;
}

function getStageCodeFromLabel(value: string): OfferStageCode | null {
  const normalized = value.trim().toUpperCase();
  for (const stage of OFFER_STAGE_CATALOG) {
    if (
      normalized === stage.code ||
      normalized.startsWith(`${stage.code} -`) ||
      normalized.startsWith(`${stage.code} —`)
    ) {
      return stage.code;
    }
  }

  return null;
}

function inferStageCode(itemName: string): OfferWorkspaceCostLine["stageCode"] {
  const lowerName = itemName.toLowerCase();

  if (
    /plan|basix|nathers|permit|survey|engineer|council|legal|service fee|water|warranty|licence|admin/.test(
      lowerName,
    )
  ) {
    return "A";
  }
  if (/temporary fence|scaffold|bin|pest/.test(lowerName)) {
    return "B";
  }
  if (/slab|drop edge|pier|concrete/.test(lowerName)) {
    return "C";
  }
  if (/frame|steel|roof/.test(lowerName)) {
    return "D";
  }
  if (/window|brick|garage door|render|cladding|facade/.test(lowerName)) {
    return "E";
  }
  if (/plumb|hot water|gas/.test(lowerName)) {
    return "F";
  }
  if (/electric|light/.test(lowerName)) {
    return "G";
  }
  if (/air conditioning|hvac/.test(lowerName)) {
    return "H";
  }
  if (/insulation|gyprock|stair|door|lock|carpenter|wardrobe|floor/.test(lowerName)) {
    return "I";
  }
  if (/waterproof|tile|tiling|sand|cement/.test(lowerName)) {
    return "J";
  }
  if (/kitchen|bath|stone|shower|appliance/.test(lowerName)) {
    return "K";
  }
  if (/pc item|selection|tapware|fixture/.test(lowerName)) {
    return "L";
  }
  if (/paint|silicon/.test(lowerName)) {
    return "M";
  }
  if (/driveway|landsc|fence|pool|solar|balcony|void/.test(lowerName)) {
    return "N";
  }

  return "O";
}

function findFormulaErrors(
  sheetName: string,
  rows: readonly (readonly unknown[])[],
): readonly string[] {
  const messages: string[] = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const value = textValue(cell);
      if (value.startsWith("#")) {
        messages.push(
          `${sheetName} ${columnLabel(columnIndex)}${rowIndex + 1} has ${value}`,
        );
      }
    });
  });

  return messages;
}

function columnLabel(columnIndex: number): string {
  let current = columnIndex + 1;
  let label = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }

  return label;
}

function findIgnoredProjectFields(
  rows: readonly (readonly unknown[])[],
): readonly string[] {
  const found = new Set<string>();

  for (const row of rows) {
    for (const cell of row) {
      const value = textValue(cell).toLowerCase();
      for (const header of PROJECT_PHASE_HEADERS) {
        if (value === header.toLowerCase()) {
          found.add(header);
        }
      }
    }
  }

  return [...found];
}

function parseLegacyPricingSettings(
  rows: readonly (readonly unknown[])[],
): LegacyWorkbookPricingSettings {
  const directTotal = numberValue(getCell(rows, 79, 7)) ?? 0;
  const overhead = numberValue(getCell(rows, 80, 7));
  const royalConstructionFee = numberValue(getCell(rows, 81, 7));

  return {
    overheadPct: rateFromAmount(overhead, directTotal, DEFAULT_LEGACY_PRICING_SETTINGS.overheadPct),
    royalConstructionFeePct: rateFromAmount(
      royalConstructionFee,
      directTotal,
      DEFAULT_LEGACY_PRICING_SETTINGS.royalConstructionFeePct,
    ),
    hbcfInsuranceFixed: numberValue(getCell(rows, 82, 7)) ?? 0,
    adminCostFixed: numberValue(getCell(rows, 84, 7)) ?? 0,
    labourCostFixed: numberValue(getCell(rows, 85, 7)) ?? 0,
    otherAdjustmentFixed: numberValue(getCell(rows, 86, 7)) ?? 0,
  };
}

function rateFromAmount(
  amount: number | null,
  base: number,
  fallback: number,
): number {
  return amount !== null && base > 0 ? amount / base : fallback;
}

function findLegacyPricingWarnings(
  rows: readonly (readonly unknown[])[],
  settings: LegacyWorkbookPricingSettings,
): readonly string[] {
  const feeLabel = textValue(getCell(rows, 81, 6));
  const labelPercent = parsePercentFromText(feeLabel);
  if (
    labelPercent === null ||
    Math.abs(labelPercent - settings.royalConstructionFeePct) < 0.005
  ) {
    return [];
  }

  return [
    `Royal Construction fee label says ${Math.round(
      labelPercent * 100,
    )}% but workbook formula implies ${Math.round(
      settings.royalConstructionFeePct * 100,
    )}%`,
  ];
}

function parsePercentFromText(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)%/.exec(value);
  const percentText = match?.[1];
  if (percentText === undefined) {
    return null;
  }

  const parsed = Number(percentText);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function parseWorkspacePricingSettings(
  rows: readonly (readonly unknown[])[],
): OfferWorkspacePricingSettings {
  return {
    targetMarkupPct: firstNumber(
      [getCell(rows, 3, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.targetMarkupPct,
    ),
    minimumMarkupPct: firstNumber(
      [getCell(rows, 4, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.minimumMarkupPct,
    ),
    gstRate: firstNumber(
      [getCell(rows, 5, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.gstRate,
    ),
    hbcfRate: firstNumber(
      [getCell(rows, 6, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.hbcfRate,
    ),
    adminCostFixed: firstNumber(
      [getCell(rows, 7, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.adminCostFixed,
    ),
    projectManagementCostFixed: firstNumber(
      [getCell(rows, 8, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.projectManagementCostFixed,
    ),
    contingencyPct: firstNumber(
      [getCell(rows, 9, 1)],
      DEFAULT_WORKSPACE_PRICING_SETTINGS.contingencyPct,
    ),
  };
}

function parseCoverArea(rows: readonly (readonly unknown[])[]): OfferAreaCalculator {
  return {
    ...INITIAL_AREA_CALCULATOR,
    groundFloorSqm: firstNumber(
      [getCell(rows, 17, 1)],
      INITIAL_AREA_CALCULATOR.groundFloorSqm,
    ),
    firstFloorSqm: firstNumber(
      [getCell(rows, 18, 1)],
      INITIAL_AREA_CALCULATOR.firstFloorSqm,
    ),
    garageSqm: firstNumber(
      [getCell(rows, 19, 1)],
      INITIAL_AREA_CALCULATOR.garageSqm,
    ),
    alfrescoSqm: firstNumber(
      [getCell(rows, 20, 1)],
      INITIAL_AREA_CALCULATOR.alfrescoSqm,
    ),
    porchSqm: firstNumber(
      [getCell(rows, 21, 1)],
      INITIAL_AREA_CALCULATOR.porchSqm,
    ),
  };
}

function parseAreaCalculator(
  rows: readonly (readonly unknown[])[],
): OfferAreaCalculator {
  const slabArea = firstNumber([getCell(rows, 7, 2)], INITIAL_AREA_CALCULATOR.groundFloorSqm);
  const slabCost = numberValue(getCell(rows, 9, 2));
  const dropEdgeCost = numberValue(getCell(rows, 10, 2));
  const dropEdgeRate = firstNumber([getCell(rows, 10, 1)], INITIAL_AREA_CALCULATOR.dropEdgeRate);
  const frameGroundCost = numberValue(getCell(rows, 9, 5));
  const frameFirstCost = numberValue(getCell(rows, 10, 5));
  const tileArea = firstNumber(
    [getCell(rows, 34, 5), getCell(rows, 34, 6)],
    INITIAL_AREA_CALCULATOR.tileAreaSqm,
  );
  const tileSupplyCost = firstNumber(
    [getCell(rows, 35, 5), getCell(rows, 35, 6)],
    INITIAL_AREA_CALCULATOR.tileAreaSqm * INITIAL_AREA_CALCULATOR.tileSupplyRatePerSqm,
  );
  const tilerCost = firstNumber(
    [getCell(rows, 36, 5), getCell(rows, 36, 6)],
    INITIAL_AREA_CALCULATOR.tileAreaSqm * INITIAL_AREA_CALCULATOR.tilerRatePerSqm,
  );

  return {
    ...INITIAL_AREA_CALCULATOR,
    groundFloorSqm: firstNumber([getCell(rows, 2, 2)], INITIAL_AREA_CALCULATOR.groundFloorSqm),
    firstFloorSqm: firstNumber([getCell(rows, 2, 5)], INITIAL_AREA_CALCULATOR.firstFloorSqm),
    alfrescoSqm: firstNumber([getCell(rows, 3, 2)], INITIAL_AREA_CALCULATOR.alfrescoSqm),
    porchSqm: firstNumber([getCell(rows, 4, 2)], INITIAL_AREA_CALCULATOR.porchSqm),
    garageSqm: firstNumber([getCell(rows, 5, 2)], INITIAL_AREA_CALCULATOR.garageSqm),
    grannyFlatSqm: firstNumber([getCell(rows, 6, 2)], INITIAL_AREA_CALCULATOR.grannyFlatSqm),
    slabRatePerSqm:
      slabCost !== null && slabArea > 0 ? slabCost / slabArea : INITIAL_AREA_CALCULATOR.slabRatePerSqm,
    dropEdgeRate,
    dropEdgeLinealMeters:
      dropEdgeCost !== null && dropEdgeRate > 0
        ? dropEdgeCost / dropEdgeRate
        : INITIAL_AREA_CALCULATOR.dropEdgeLinealMeters,
    frameGroundRatePerSqm:
      frameGroundCost !== null && slabArea > 0
        ? frameGroundCost / slabArea
        : INITIAL_AREA_CALCULATOR.frameGroundRatePerSqm,
    frameFirstRatePerSqm:
      frameFirstCost !== null && firstNumber([getCell(rows, 2, 5)], 0) > 0
        ? frameFirstCost / firstNumber([getCell(rows, 2, 5)], 1)
        : INITIAL_AREA_CALCULATOR.frameFirstRatePerSqm,
    steelAllowance: firstNumber([getCell(rows, 11, 5)], INITIAL_AREA_CALCULATOR.steelAllowance),
    frameInstallAllowance: firstNumber(
      [getCell(rows, 12, 5)],
      INITIAL_AREA_CALCULATOR.frameInstallAllowance,
    ),
    extraTruckCost: firstNumber([getCell(rows, 13, 2)], INITIAL_AREA_CALCULATOR.extraTruckCost),
    brickGroundLinealMeters: firstNumber(
      [getCell(rows, 8, 10)],
      INITIAL_AREA_CALCULATOR.brickGroundLinealMeters,
    ),
    brickFirstLinealMeters: firstNumber(
      [getCell(rows, 9, 14)],
      INITIAL_AREA_CALCULATOR.brickFirstLinealMeters,
    ),
    brickGroundHeight: firstNumber([getCell(rows, 9, 10)], INITIAL_AREA_CALCULATOR.brickGroundHeight),
    brickFirstHeight: firstNumber([getCell(rows, 10, 14)], INITIAL_AREA_CALCULATOR.brickFirstHeight),
    tileAreaSqm: tileArea,
    tileSupplyRatePerSqm: tileArea > 0 ? tileSupplyCost / tileArea : INITIAL_AREA_CALCULATOR.tileSupplyRatePerSqm,
    tilerRatePerSqm: tileArea > 0 ? tilerCost / tileArea : INITIAL_AREA_CALCULATOR.tilerRatePerSqm,
    tileAnglesAllowance: firstNumber(
      [getCell(rows, 37, 5), getCell(rows, 37, 6)],
      INITIAL_AREA_CALCULATOR.tileAnglesAllowance,
    ),
  };
}
