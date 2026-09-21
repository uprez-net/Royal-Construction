import type { ProjectStage } from "@prisma/client";

import { stageClaimAmount } from "@/lib/projects/milestone-ledger";
import { matchPaymentStagesToProjectStages } from "@/lib/projects/payment-stages";
import { PROJECT_STAGE_PERCENTAGE } from "@/types/project";
import type { ProjectPaymentStage } from "@/types/project-flow";

/** What one stage claims: the percentage it is shown as, and the dollars it bills. */
export type StageClaim = {
  /** Percentage points (15 for 15%), or null when the schedule states none. */
  readonly percentage: number | null;
  /** Dollars, or null when nothing can be known — never coerce this to 0. */
  readonly claim: number | null;
};

export type StageClaims = Record<ProjectStage, StageClaim>;

/**
 * What each project stage claims.
 *
 * The resolution order — the contract's own amount, else its percentage, else
 * the static NSW schedule — was written out inline twice in the milestones tab
 * and is now also what an invoice is raised for. Three copies of a money
 * calculation is three chances for the invoice to disagree with the figure the
 * operator was looking at when they completed the stage, so it lives here once.
 *
 * A stage resolves to `null` when nothing can be known about it (no contract
 * amount, no percentage, or an unusable budget). Callers must treat that as
 * "unknown", never as zero: invoicing a stage for $0 is a confident wrong
 * number, and showing one is worse than showing an em dash.
 */
export function resolveStageClaims(
  paymentStages: readonly ProjectPaymentStage[] | null | undefined,
  totalBudget: number,
): StageClaims {
  const contractStages = matchPaymentStagesToProjectStages(paymentStages);
  const stages = Object.keys(PROJECT_STAGE_PERCENTAGE) as ProjectStage[];

  return stages.reduce((claims, stage) => {
    const contractStage = contractStages[stage];

    // `PROJECT_STAGE_PERCENTAGE` holds fractions (0.15) while `stageClaimAmount`
    // expects percentage points and divides by 100. Dropping this conversion
    // under-bills by a factor of 100.
    const fallback = PROJECT_STAGE_PERCENTAGE[stage];
    const percentage =
      contractStage?.percentage ?? (fallback != null ? fallback * 100 : null);

    claims[stage] = {
      percentage,
      claim: stageClaimAmount(contractStage?.amount, percentage, totalBudget),
    };

    return claims;
  }, {} as StageClaims);
}

/**
 * The whole claim schedule added up.
 *
 * Deliberately sums every stage, not only the ones currently carrying
 * milestones: the contract total does not shrink because a stage was emptied.
 * Returns null when no stage resolved an amount at all — an unknown total, not
 * a zero one.
 */
export function contractClaimTotal(claims: StageClaims): number | null {
  const amounts = Object.values(claims)
    .map((stage) => stage.claim)
    .filter((amount): amount is number => amount !== null);

  return amounts.length === 0
    ? null
    : amounts.reduce((total, amount) => total + amount, 0);
}
