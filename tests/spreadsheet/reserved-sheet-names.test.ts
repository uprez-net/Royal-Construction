import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import ExcelJS from "exceljs";

import { REPO_ROOT } from "../support/repo-root";

// Excel reserves "History" and ExcelJS throws on it. Both lead exports named a
// sheet that, so Export threw inside an unawaited click handler and produced no
// file and no message from the day ExcelJS replaced SheetJS.

test("ExcelJS refuses the sheet name History", () => {
  assert.throws(
    () => new ExcelJS.Workbook().addWorksheet("History"),
    /protected/,
  );
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test("no exported workbook names a sheet History", () => {
  const offenders = ["components", "app", "lib"]
    .flatMap((dir) => sources(join(REPO_ROOT, dir)))
    .filter((file) =>
      /name:\s*"History"\s*,\s*rows/.test(readFileSync(file, "utf8")),
    );
  assert.deepEqual(offenders, []);
});
