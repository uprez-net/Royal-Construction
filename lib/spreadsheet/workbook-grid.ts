import type { Cell, Row, Workbook, Worksheet } from "exceljs";
import { loadExcelJs } from "@/lib/spreadsheet/exceljs-loader";

/** A merged region, as 0-based inclusive bounds. */
export type SheetMerge = {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
};

/**
 * One worksheet flattened into dense, 0-indexed grids.
 *
 * `raw` keeps the underlying values — numbers stay numbers, and a formula
 * collapses to its computed result — while `display` is the text the cell
 * shows. Callers need both: value parsing reads `raw`, while error detection
 * (`#REF!`, `#DIV/0!`) and the preview table read `display`.
 */
export type SheetGrid = {
  readonly name: string;
  readonly raw: readonly (readonly unknown[])[];
  readonly display: readonly (readonly string[])[];
  readonly merges: readonly SheetMerge[];
};

/** Every sheet in a workbook, keyed by name, in workbook order. */
export type WorkbookGrid = ReadonlyMap<string, SheetGrid>;

/**
 * Read a spreadsheet into plain grids.
 *
 * ExcelJS models a sheet as a sparse, 1-indexed object graph where a cell may
 * hold a formula wrapper, a rich-text run, a hyperlink or an error. Every
 * caller in this app wants the same two flat views instead, so that conversion
 * lives here once rather than being repeated in each importer and preview.
 *
 * Only the OOXML formats (`.xlsx`/`.xlsm`) are supported. ExcelJS cannot read
 * the legacy binary `.xls` format and reports it as a corrupt zip.
 */
export async function readWorkbookGrid(
  data: ArrayBuffer,
): Promise<WorkbookGrid> {
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  // ExcelJS types `load` as taking a Node `Buffer`, which its own typings
  // declare as extending ArrayBuffer. At runtime it accepts the plain
  // ArrayBuffer that `File.arrayBuffer()` and `Response.arrayBuffer()` return.
  await workbook.xlsx.load(data as Parameters<typeof workbook.xlsx.load>[0]);

  return toWorkbookGrid(workbook);
}

/** The raw grid for `sheetName`, or an empty grid when the sheet is absent. */
export function rawRows(
  workbook: WorkbookGrid,
  sheetName: string,
): readonly (readonly unknown[])[] {
  return workbook.get(sheetName)?.raw ?? [];
}

/** The display grid for `sheetName`, or an empty grid when the sheet is absent. */
export function displayRows(
  workbook: WorkbookGrid,
  sheetName: string,
): readonly (readonly string[])[] {
  return workbook.get(sheetName)?.display ?? [];
}

function toWorkbookGrid(workbook: Workbook): WorkbookGrid {
  const grid = new Map<string, SheetGrid>();
  workbook.eachSheet((worksheet) => {
    grid.set(worksheet.name, toSheetGrid(worksheet));
  });

  return grid;
}

function toSheetGrid(worksheet: Worksheet): SheetGrid {
  const { rowCount, columnCount } = worksheet;
  const raw: unknown[][] = [];
  const display: string[][] = [];

  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const rawRow: unknown[] = new Array<unknown>(columnCount).fill("");
    const displayRow = new Array<string>(columnCount).fill("");
    readRow(worksheet.getRow(rowNumber), columnCount, rawRow, displayRow);
    raw.push(rawRow);
    display.push(displayRow);
  }

  return { name: worksheet.name, raw, display, merges: readMerges(worksheet) };
}

function readRow(
  row: Row,
  columnCount: number,
  rawRow: unknown[],
  displayRow: string[],
): void {
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    if (columnNumber > columnCount) {
      return;
    }

    rawRow[columnNumber - 1] = rawCellValue(cell);
    displayRow[columnNumber - 1] = displayCellValue(cell);
  });
}

function rawCellValue(cell: Cell): unknown {
  if (isCoveredByMerge(cell)) {
    return "";
  }

  const { value } = cell;
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date || typeof value !== "object") {
    return value;
  }

  const error = errorText(value);
  if (error !== null) {
    return error;
  }
  if ("richText" in value) {
    return value.richText.map((run) => run.text).join("");
  }
  if ("formula" in value || "sharedFormula" in value) {
    return formulaResult(value.result);
  }
  if ("text" in value) {
    return String(value.text);
  }

  return "";
}

function displayCellValue(cell: Cell): string {
  if (isCoveredByMerge(cell)) {
    return "";
  }

  const { value } = cell;
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return formatDate(value);
  }

  if (typeof value === "object") {
    const error = errorText(value);
    if (error !== null) {
      return error;
    }
    if ("formula" in value || "sharedFormula" in value) {
      const result = formulaResult(value.result);
      // `cell.text` stringifies a formula whose result is an error to
      // "[object Object]", so an unreadable workbook would otherwise look
      // clean. Formatting the unwrapped result here is what makes the
      // #REF!/#DIV/0! warnings work at all.
      if (result instanceof Date) {
        return formatDate(result);
      }
      if (typeof result !== "number" && typeof result !== "boolean") {
        return String(result);
      }
    }
  }

  return cell.text ?? "";
}

/**
 * A cell covered by a merge repeats its anchor's value in ExcelJS. Report it
 * empty so a merged region contributes its value once, at the anchor, and a
 * merged error cell raises one warning rather than one per covered cell.
 */
function isCoveredByMerge(cell: Cell): boolean {
  return cell.master !== cell;
}

/**
 * The text an error cell shows (`#REF!`, `#DIV/0!`, …), or null when the value
 * is not an error. ExcelJS reports an error either directly or as the result
 * of a formula, so both paths funnel through here.
 */
function errorText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { error } = value as { readonly error?: unknown };
  return typeof error === "string" ? error : null;
}

function formulaResult(result: unknown): unknown {
  const error = errorText(result);
  if (error !== null) {
    return error;
  }

  return result ?? "";
}

/**
 * Dates render as a plain `YYYY-MM-DD` (plus `HH:MM` when the cell carries a
 * time). ExcelJS's own `cell.text` returns a full JS `Date#toString`, timezone
 * suffix and all, which is unreadable in a preview cell.
 */
function formatDate(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, "0");
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  if (
    value.getHours() === 0 &&
    value.getMinutes() === 0 &&
    value.getSeconds() === 0
  ) {
    return date;
  }

  return `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function readMerges(worksheet: Worksheet): readonly SheetMerge[] {
  const merges: SheetMerge[] = [];

  for (const range of worksheet.model.merges ?? []) {
    const merge = parseMergeRange(range);
    if (merge !== null) {
      merges.push(merge);
    }
  }

  return merges;
}

function parseMergeRange(range: string): SheetMerge | null {
  const [start, end] = range.split(":");
  const startCell = parseCellReference(start ?? "");
  const endCell = parseCellReference(end ?? start ?? "");
  if (startCell === null || endCell === null) {
    return null;
  }

  return {
    startRow: startCell.row,
    startColumn: startCell.column,
    endRow: endCell.row,
    endColumn: endCell.column,
  };
}

function parseCellReference(
  reference: string,
): { readonly row: number; readonly column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(reference.trim().toUpperCase());
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) {
    return null;
  }

  let column = 0;
  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }

  return { row: Number(digits) - 1, column: column - 1 };
}
