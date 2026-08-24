import type { BudgetStatus } from "@/types/project";

/**
 * Single source of truth for budget health classification.
 *
 * Pure by design: no React, no Redux, no I/O — only two numbers in, one
 * `BudgetStatus` out. Keeping it here means the selector, the four badge
 * surfaces, and any future consumer all apply the same rule, so a project
 * can never read as "On budget" in one place and "Over budget" in another.
 *
 * Rule order matters: a non-finite or non-positive budget is treated as
 * "nothing recorded yet" before any comparison with `spent`, and a `spent`
 * of exactly zero is also `NOT_STARTED` rather than a degenerate `ON_BUDGET`.
 */
export function getBudgetStatus(
  totalBudget: number,
  spent: number,
): BudgetStatus {
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
    return "NOT_STARTED";
  }

  if (!Number.isFinite(spent)) {
    return "NOT_STARTED";
  }

  if (spent > totalBudget) {
    return "OVER_BUDGET";
  }

  if (spent <= 0) {
    return "NOT_STARTED";
  }

  return "ON_BUDGET";
}
