import type { MilestoneStatus, ProjectStage } from "@prisma/client";

/** The minimum a milestone needs for the stage counter. */
export interface StageProgressMilestone {
  projectStage: ProjectStage;
  status: MilestoneStatus;
}

/**
 * How many contract stages are finished, out of the stages this project has.
 *
 * Counts the FLAT milestone list — parents and children alike — rather than
 * walking the tree the way `stageState` does. The two agree on every stage
 * whose sub-activities share their parent's stage, which is all but one row in
 * the template. Kept flat here because this is a progress counter shown on
 * cards and tab badges, and changing how it counts would move numbers on
 * screens nobody asked to change; `stageState` remains the authority wherever a
 * decision hangs off completion, invoicing included.
 */
export function calcStageProgress(
  milestones: readonly StageProgressMilestone[],
): { totalStages: number; completedStages: number } {
  const byStage = new Map<ProjectStage, { completed: number; total: number }>();

  for (const milestone of milestones) {
    const stage = byStage.get(milestone.projectStage) ?? { completed: 0, total: 0 };
    stage.total += 1;
    if (milestone.status === "DONE" || milestone.status === "NOT_REQUIRED") {
      stage.completed += 1;
    }
    byStage.set(milestone.projectStage, stage);
  }

  return {
    totalStages: byStage.size,
    completedStages: [...byStage.values()].filter(
      (stage) => stage.completed === stage.total,
    ).length,
  };
}
