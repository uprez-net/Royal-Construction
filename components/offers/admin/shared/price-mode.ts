import type {
  CostScheduleRow,
  CostScheduleRowBase,
  PriceMode,
} from "@/types/admin-offer-content";

// The fields every mode shares. The rest spread deliberately leaves the other
// modes' `value` / `formula` on the object, which is what lets a round trip
// through another mode hand the admin their number back. The save schema
// strips whichever of the two the row's mode does not use.
export function stripBase(row: CostScheduleRow): CostScheduleRowBase {
  const { priceMode: _priceMode, ...base } = row;
  void _priceMode;
  return base;
}

// Switching mode used to reset the row to `value: 0` or `formula: ""`, so one
// misclick on the mode select destroyed a price or formula the admin had typed.
// A value or formula still carried on the row is restored instead.
export function withMode(row: CostScheduleRow, mode: PriceMode): CostScheduleRow {
  const base = stripBase(row);
  switch (mode) {
    case "none":
      return { ...base, priceMode: "none" };
    case "fixed":
      return {
        ...base,
        priceMode: "fixed",
        value: "value" in row && typeof row.value === "number" ? row.value : 0,
      };
    case "formula":
      return {
        ...base,
        priceMode: "formula",
        formula:
          "formula" in row && typeof row.formula === "string" ? row.formula : "",
      };
  }
}
