import type { ProjectStage } from "@prisma/client";

import { flattenMilestones, stageState } from "@/lib/projects/milestone-ledger";
import {
  buildMilestoneTree,
  groupRootsByStage,
} from "@/lib/projects/milestone-tree";

import type { DomainDb } from "../db";

// "Does settling this milestone finish a contract stage that has not been
// claimed yet?"
//
// The decision, separated from the Xero call that acts on it. It was inside
// `lib/data/invoice.ts#ensureStageInvoice`, which opens with `next/cache`,
// `@vercel/blob` and `xero-node` — so Eve could not ask the question at all,
// and `updateMilestoneDirect` simply never raised a claim. Completing the last
// activity of a stage through the agent left the progress claim unraised, with
// nothing anywhere saying so. That is money in front of a customer, which is
// the expensive category here.
//
// Every exit is a guard and the whole thing is safe to run repeatedly: it is
// called once per milestone that settles, including every retry.

export type DueStageClaim = {
  readonly projectId: string;
  readonly projectStage: ProjectStage;
};

/**
 * The stage a settled milestone just completed, when a claim is now due and
 * none has been raised — otherwise `null`.
 *
 * Takes a milestone rather than a stage because the two are not the same
 * question. A sub-activity may carry a different `projectStage` from the root
 * it hangs off — the template has one, a Lockup activity under a Frame
 * inspection — and the stage it actually completes is its ROOT's, which is how
 * the Milestones tab groups it. Trusting the milestone's own `projectStage`
 * would check a group the milestone is not in and quietly never raise the
 * claim it just finished.
 */
export async function resolveDueStageClaim(
  input: { projectId: string; milestoneId: string },
  db: DomainDb,
): Promise<DueStageClaim | null> {
  const milestones = await db.milestone.findMany({
    where: { projectId: input.projectId },
    select: {
      id: true,
      parentId: true,
      order: true,
      projectStage: true,
      name: true,
      status: true,
      targetDate: true,
      actualDate: true,
    },
  });

  // Group the way the Milestones tab does — roots by stage, whole subtree
  // considered — so the stage the operator sees as complete is exactly the one
  // that gets claimed.
  const grouped = groupRootsByStage(buildMilestoneTree(milestones));

  let stage: ProjectStage | undefined;
  let stageMilestones: (typeof grouped)[ProjectStage] = [];
  for (const [candidate, candidateMilestones] of Object.entries(grouped)) {
    const contains = flattenMilestones(candidateMilestones ?? []).some(
      (milestone) => milestone.id === input.milestoneId,
    );
    if (contains) {
      stage = candidate as ProjectStage;
      stageMilestones = candidateMilestones ?? [];
      break;
    }
  }
  if (!stage) return null;

  if (stageState(stageMilestones) !== "complete") return null;

  // A stage whose every activity was waived was never worked, so there is
  // nothing to claim. `stageState` calls that "complete" — correctly, nothing
  // is outstanding — but completing a stage is not the same as earning it.
  const activities = flattenMilestones(stageMilestones);
  if (activities.every((milestone) => milestone.status === "NOT_REQUIRED")) {
    return null;
  }

  // Only ever the stage that just finished. Deliberately not a sweep of every
  // complete-and-unclaimed stage: on a project already part-built when this
  // shipped, that would bill the owner for stages the builder has almost
  // certainly already invoiced by hand.
  const existing = await db.invoice.findUnique({
    where: {
      projectId_projectStage: {
        projectId: input.projectId,
        projectStage: stage,
      },
    },
    select: { id: true },
  });
  if (existing) return null;

  return { projectId: input.projectId, projectStage: stage };
}
