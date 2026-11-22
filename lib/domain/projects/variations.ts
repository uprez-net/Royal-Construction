import { VariationStatus } from "@prisma/client";
import { addDays, differenceInCalendarDays } from "date-fns";

import { authorizeProject, canSeeProjectFinancials } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../errors";
import type { DomainPrincipal } from "../principal";

// Variations: deciding one raised the old way, and what an approval does to
// the schedule. Raising one now lives in `variation-raise.ts`, which raises it
// already APPROVED, and issuing it in `variation-issue.ts`.
//
// Phase 4 of issue #301 asked for the shared variation service to be built
// **first**, so the future Eve tool calls the same command as the App route
// rather than growing a second copy the way the offer and milestone rules did.
// There is no Eve variation tool today; this is that command, written once.
//
// Two defects fixed on the way through, both reachable by one person:
//
//   - **No caller check.** `app/api/(data)/projects/[projectId]/variations/[variationId]`
//     took a `variationId` from the URL and approved it, without checking the
//     variation belonged to the project in the same URL or that the caller may
//     manage that project. Approving a variation moves money and the
//     completion date.
//   - **Approving twice applied the delay twice.** `updateVariationStatus`
//     re-stamped `approvedDate = new Date()` on every call and then
//     `applyVariationDelay` shifted every pending milestone and the project's
//     estimated end date again. A double-click on Approve, or a retry after a
//     timeout, silently moved the whole remaining programme out by a second
//     margin. A decided variation is now refused, and the delay is applied in
//     the same transaction as the decision, guarded on `delayDays` being
//     unset.

export type VariationDecision = "APPROVED" | "REJECTED";

export type VariationDecisionOutcome = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly description: string;
  readonly cost: string;
  readonly status: VariationStatus;
  readonly approvedDate: Date | null;
  /** Days the approval pushed the remaining programme out, if it approved. */
  readonly delayDays: number | null;
  /** Milestones whose target date moved. */
  readonly shiftedMilestoneIds: readonly string[];
  readonly siteManagerId: string | null;
};

/**
 * Approve or reject a variation, applying the schedule delay in the same
 * transaction as the approval.
 *
 * The delay is the calendar gap between when the variation was requested and
 * when it was decided: work stopped while the owner thought about it, so every
 * activity that has not started yet moves out by that many days, and so does
 * the project's estimated end date. The currently ACTIVE milestone is left
 * alone — it is already under way — along with anything before it.
 */
export async function decideVariation(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    variationId: string;
    decision: VariationDecision;
  },
  db: DomainDb,
): Promise<VariationDecisionOutcome> {
  // Approving moves the contract value and the programme, which is the
  // office's money (`canSeeProjectFinancials`), the same rule that lets only
  // the office raise one (`raiseVariation`). Checked before the project is
  // read, and before `authorizeProject`, so a site manager on the project is
  // still refused.
  if (!canSeeProjectFinancials(principal)) {
    throw new DomainAuthorizationError("Variations are decided by the office.");
  }
  const project = await authorizeProject(principal, input.projectId, db);

  const variation = await db.variation.findFirst({
    where: { id: input.variationId, projectId: input.projectId },
    select: {
      id: true,
      cost: true,
      delayDays: true,
      description: true,
      requestedDate: true,
      status: true,
    },
  });
  if (!variation) {
    throw new DomainNotFoundError(
      "That variation does not belong to this project.",
    );
  }

  if (variation.status !== VariationStatus.PENDING) {
    throw new DomainTransitionError(
      `This variation was already ${variation.status.toLowerCase()}.`,
      variation.status,
      input.decision,
    );
  }

  const approvedDate = input.decision === "APPROVED" ? new Date() : null;

  const updated = await db.variation.update({
    where: { id: variation.id },
    data:
      input.decision === "APPROVED"
        ? { status: VariationStatus.APPROVED, approvedDate }
        : { status: VariationStatus.REJECTED, approvedDate: null },
    select: {
      approvedDate: true,
      cost: true,
      description: true,
      id: true,
      status: true,
    },
  });

  if (input.decision !== "APPROVED" || !approvedDate) {
    return {
      approvedDate: null,
      cost: updated.cost.toString(),
      delayDays: null,
      description: updated.description,
      id: updated.id,
      projectId: input.projectId,
      projectName: project.name,
      shiftedMilestoneIds: [],
      siteManagerId: project.siteManagerId,
      status: updated.status,
    };
  }

  const delayDays = differenceInCalendarDays(
    approvedDate,
    variation.requestedDate,
  );

  // `delayDays` already set means the schedule was shifted for this variation
  // once before. Nothing should reach here — the PENDING guard above covers
  // the double-click — but the shift is destructive and unrecoverable, so it
  // refuses to run twice rather than trusting one guard.
  if (variation.delayDays !== null || delayDays <= 0) {
    await db.variation.update({
      where: { id: variation.id },
      data: { delayDays: variation.delayDays ?? delayDays },
    });
    return {
      approvedDate,
      cost: updated.cost.toString(),
      delayDays: variation.delayDays ?? delayDays,
      description: updated.description,
      id: updated.id,
      projectId: input.projectId,
      projectName: project.name,
      shiftedMilestoneIds: [],
      siteManagerId: project.siteManagerId,
      status: updated.status,
    };
  }

  await db.variation.update({
    where: { id: variation.id },
    data: { delayDays },
  });

  const milestones = await db.milestone.findMany({
    where: { projectId: input.projectId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, status: true, targetDate: true },
  });

  const activeOrder =
    milestones.find((milestone) => milestone.status === "ACTIVE")?.order ?? 0;
  const toShift = milestones.filter(
    (milestone) =>
      milestone.status === "PENDING" && milestone.order > activeOrder,
  );

  for (const milestone of toShift) {
    await db.milestone.update({
      where: { id: milestone.id },
      data: { targetDate: addDays(milestone.targetDate, delayDays) },
    });
  }

  const current = await db.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { estimatedEndDate: true },
  });
  await db.project.update({
    where: { id: input.projectId },
    data: {
      estimatedEndDate: addDays(current.estimatedEndDate, delayDays),
    },
  });

  return {
    approvedDate,
    cost: updated.cost.toString(),
    delayDays,
    description: updated.description,
    id: updated.id,
    projectId: input.projectId,
    projectName: project.name,
    shiftedMilestoneIds: toShift.map((milestone) => milestone.id),
    siteManagerId: project.siteManagerId,
    status: updated.status,
  };
}
