import type { BudgetStatus } from "@/types/project";

/**
 * Single source of truth for how a `BudgetStatus` is presented.
 *
 * Modeled on `project-status.ts`: a typed `Record` map plus a never-throw
 * accessor with a neutral fallback, so an unmapped status renders neutral
 * rather than crashing the surface. Tone names match `StatusPill`'s map in
 * `components/common/status-pill.tsx` (`neutral`, `success`, `danger`).
 */
export interface BudgetStatusConfig {
  label: string;
  tone: "neutral" | "success" | "danger";
}

const BUDGET_STATUS_CONFIG: Record<BudgetStatus, BudgetStatusConfig> = {
  NOT_STARTED: { label: "No spend recorded", tone: "neutral" },
  ON_BUDGET: { label: "On budget", tone: "success" },
  OVER_BUDGET: { label: "Over budget", tone: "danger" },
};

const FALLBACK_BUDGET_STATUS_CONFIG: BudgetStatusConfig = {
  label: "No spend recorded",
  tone: "neutral",
};

/**
 * Resolves the render config for a budget status. Never throws on an
 * unmapped value — an unknown status renders the neutral "no spend recorded"
 * pill rather than crashing the row.
 */
export function budgetStatusConfig(status: BudgetStatus): BudgetStatusConfig {
  return BUDGET_STATUS_CONFIG[status] ?? FALLBACK_BUDGET_STATUS_CONFIG;
}
