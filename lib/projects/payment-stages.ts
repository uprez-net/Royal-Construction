import type { ProjectStage } from "@prisma/client";

import type { ProjectPaymentStage } from "@/types/project-flow";

/**
 * Fallback percentages for the standard NSW residential claim schedule, used
 * when a stage label carries no explicit "N%" token (e.g. a bare "Slab" row).
 */
const LABEL_PERCENTAGE_RECORD: Record<string, number> = {
  deposit: 5,
  slab: 15,
  frame: 25,
  "lock up": 25,
  "interior fit out": 20,
  final: 10,
};

/** First "N%" / "N %" token in a label. Not global — only the first wins. */
const PERCENT_TOKEN = /(\d+(?:\.\d+)?)\s*%/;

/**
 * The percentage a stage claims, read from its label. An explicit token beats
 * the keyword table, so "Frame 30%" is 30 even though "frame" maps to 25.
 */
export function stagePercentageFromLabel(label: string): number | null {
  const percentageMatch = label.match(PERCENT_TOKEN);
  if (percentageMatch) {
    return Number(percentageMatch[1]);
  }

  const normalizedLabel = label.toLowerCase();
  return (
    Object.entries(LABEL_PERCENTAGE_RECORD).find(([key]) =>
      new RegExp(`\b${key}\b`).test(normalizedLabel),
    )?.[1] ?? null
  );
}

/** True when the percentage came from the label itself, not the keyword table. */
export function hasExplicitStagePercentage(label: string): boolean {
  return PERCENT_TOKEN.test(label);
}

/**
 * Extraction stores each payment stage as a single label string, so the
 * percentage and dollar value are derived on read. Keep this the only place
 * that derivation happens — the create flow previews exactly what gets stored.
 */
export function calculatePercentageAmount(
  label: string,
  totalContractSum: number | null,
): ProjectPaymentStage {
  const percentage = stagePercentageFromLabel(label);

  return {
    label,
    percentage,
    amount:
      percentage !== null && totalContractSum !== null
        ? (totalContractSum * percentage) / 100
        : null,
  };
}

export function paymentStagesFromLabels(
  labels: readonly string[],
  totalContractSum: number | null,
): ProjectPaymentStage[] {
  return labels.map((label) =>
    calculatePercentageAmount(label, totalContractSum),
  );
}

/**
 * Write a percentage back into a label, since the label is the stored form.
 * Replaces an existing token, appends when there is none, and strips the token
 * entirely for `null` so a cleared percent field doesn't leave "Slab %" behind.
 */
export function withStagePercentage(
  label: string,
  percentage: number | null,
): string {
  if (percentage === null) {
    return label.replace(PERCENT_TOKEN, "").replace(/\s{2,}/g, " ").trim();
  }

  if (PERCENT_TOKEN.test(label)) {
    return label.replace(PERCENT_TOKEN, `${percentage}%`);
  }

  return `${label.trim()} ${percentage}%`.trim();
}

/**
 * Keyword patterns that tie an extracted stage label back to a `ProjectStage`.
 * Contracts word the schedule slightly differently every time ("Lock-up",
 * "Interior Fitout", "Final Completion"), but the six stages themselves are
 * fixed, so match on the recognisable word rather than on an exact label.
 */
const STAGE_LABEL_PATTERNS: Record<ProjectStage, RegExp> = {
  Deposit: /\bdeposit\b/i,
  Slab: /\bslab\b/i,
  Frame: /\bfram(e|es|ing)\b/i,
  Lockup: /\block[\s-]?up\b/i,
  Interior_Fit_Out: /\b(interior|fit[\s-]?out)\b/i,
  Final: /\b(final|completion|handover)\b/i,
};

const PROJECT_STAGE_ORDER = Object.keys(STAGE_LABEL_PATTERNS) as ProjectStage[];

/**
 * Pair each extracted payment stage with the project stage it pays for.
 *
 * Stages are consumed in document order and each project stage is claimed at
 * most once, so a schedule that mentions "Frame" twice maps the first row and
 * leaves the second unmatched rather than overwriting. Anything that matches
 * nothing is simply absent from the result — callers fall back to the static
 * `PROJECT_STAGE_PERCENTAGE` table for those.
 */
export function matchPaymentStagesToProjectStages(
  stages: readonly ProjectPaymentStage[] | null | undefined,
): Partial<Record<ProjectStage, ProjectPaymentStage>> {
  const matched: Partial<Record<ProjectStage, ProjectPaymentStage>> = {};
  if (!stages?.length) return matched;

  for (const stage of stages) {
    const projectStage = PROJECT_STAGE_ORDER.find(
      (candidate) =>
        matched[candidate] === undefined &&
        STAGE_LABEL_PATTERNS[candidate].test(stage.label),
    );

    if (projectStage) {
      matched[projectStage] = stage;
    }
  }

  return matched;
}

/**
 * A stage label for display, normalised to the "Name (N%)" shape the static
 * `PROJECT_STAGE_LABELS` use, so an extracted "Deposit 5%" and a fallback
 * label don't render in two different styles side by side.
 */
export function formatPaymentStageLabel(stage: ProjectPaymentStage): string {
  const name = withStagePercentage(stage.label, null);
  if (!name) return stage.label.trim();

  return stage.percentage === null ? name : `${name} (${stage.percentage}%)`;
}
