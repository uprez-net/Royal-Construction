import { loadExcelJs } from "@/lib/spreadsheet/exceljs-loader";

/** One sheet of an exported workbook: a name and its rows, header row first. */
export type WorkbookSheet = {
  readonly name: string;
  readonly rows: readonly (readonly unknown[])[];
};

const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Build an `.xlsx` workbook in the browser and save it as `filename`.
 *
 * Unlike SheetJS, ExcelJS has no browser-side `writeFile` — it produces a
 * buffer and leaves saving to the caller — so the object-URL dance lives here
 * once instead of in every export button.
 *
 * Callers must be client-side; this touches `document` and `URL`.
 */
export async function downloadWorkbook(
  sheets: readonly WorkbookSheet[],
  filename: string,
): Promise<void> {
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();

  for (const sheet of sheets) {
    // ExcelJS mutates the arrays it is handed, so pass it copies.
    workbook.addWorksheet(sheet.name).addRows(sheet.rows.map((row) => [...row]));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: XLSX_MIME_TYPE }), filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on a later task: revoking in the same tick as the click cancels the
  // download that is still starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
