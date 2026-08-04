import { evaluate } from "mathjs";
import type {
  AreaMeasurementKey,
  RateConstantKey,
} from "@/lib/offer/formula-variables";

// Build the scope object mathjs sees when evaluating a cost-schedule formula
// string. Merges admin-editable rate constants with per-offer area
// measurements (from Job setup + the Area Calculator). If a key is present in
// both, measurements win — they're the project-specific override.
export function buildFormulaScope(
  rateConstants: Partial<Record<RateConstantKey, number>>,
  measurements: Partial<Record<AreaMeasurementKey, number>>,
): Record<string, number> {
  return { ...rateConstants, ...measurements };
}

// Evaluate a formula string like "SLAB_AREA * SLAB_RATE_PER_SQM" against the
// given scope. Returns 0 on failure (never throws — a broken formula must not
// brick the offer total; the estimator sees the $0 and fixes the formula).
export function evaluateCostFormula(
  formula: string,
  scope: Record<string, number>,
): number {
  if (!formula.trim()) return 0;
  try {
    const result = evaluate(formula, scope);
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return 0;
    }
    return result;
  } catch {
    return 0;
  }
}