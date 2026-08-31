type ExcelJsModule = typeof import("exceljs");

/**
 * Load ExcelJS on demand.
 *
 * The library is well over a megabyte, and every feature that needs it sits
 * behind a button or a preview that most visitors never open, so it is never
 * imported at module scope. Bundlers resolve the package's `browser` field to
 * a UMD build whose ESM interop puts the real module behind `default` in some
 * bundles but not others — pick whichever object actually carries `Workbook`
 * rather than assuming one shape.
 */
export async function loadExcelJs(): Promise<ExcelJsModule> {
  const loaded = (await import("exceljs")) as ExcelJsModule & {
    readonly default?: ExcelJsModule;
  };

  return loaded.default?.Workbook === undefined ? loaded : loaded.default;
}
