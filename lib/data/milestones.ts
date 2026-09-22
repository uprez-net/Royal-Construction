import "server-only";

import { after } from "next/server";
import { revalidateTag } from "next/cache";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { ensureStageInvoice } from "@/lib/data/invoice";
import { logAction } from "@/lib/domain/audit/action-log";
import { findAdminUserIds } from "@/lib/domain/identity/users";
import {
  attachMilestonePhotos,
  createMilestone as createMilestoneCommand,
  createMilestonesFromTemplate,
  listProjectMilestones,
  updateMilestone as updateMilestoneCommand,
} from "@/lib/domain/projects/milestones";
import { attributionUserId } from "@/lib/domain/principal";
import { triggerNotification } from "@/lib/notification/novu";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import type {
  MilestoneCreationData,
  MilestoneUpdateData,
} from "@/utils/validators";

// The Next adapter over `lib/domain/projects/milestones.ts`.
//
// The ordering rule, the state machine, the parent roll-up, the project spend
// and status recalculation and the "does this settle a claimable stage?"
// decision all moved to the domain in phase 4, so the agent runs the same ones.
// What is left here is post-commit work that only a request can do: the cache
// tags, the Novu notification, and the Xero call behind the progress claim.

/** Who a milestone event reaches: the site manager, plus every ADMIN. */
async function milestoneAudience(siteManagerId: string | null) {
  const admins = await findAdminUserIds(prisma);
  return siteManagerId ? [siteManagerId, ...admins] : admins;
}

export async function getMilestonesByProject(projectId: string) {
  return listProjectMilestones(await currentPrincipal(), projectId, prisma);
}

/**
 * Add a milestone to a project.
 *
 * The insert shifts a run of sibling rows, so it owns a transaction; the
 * notification and the cache tag happen after the response.
 */
export async function createMilestone(
  projectId: string,
  data: MilestoneCreationData,
) {
  const principal = await currentPrincipal();

  const milestone = await prisma.$transaction((tx) =>
    createMilestoneCommand(
      principal,
      {
        budget: data.budget,
        description: data.description,
        name: data.name,
        parentId: data.parentId,
        projectId,
        projectStage: data.projectStage,
        targetDate: data.targetDate,
      },
      tx,
    ),
  );

  after(async () => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, siteManagerId: true },
    });

    await logAction(
      {
        ...createActivityLogEntry("milestoneAdded", {
          milestoneId: milestone.id,
          milestoneName: milestone.name,
          projectId: milestone.projectId,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );

    await triggerNotification(
      await milestoneAudience(project?.siteManagerId ?? null),
      createNotification("milestoneAdded", {
        milestoneId: milestone.id,
        milestoneName: milestone.name,
        projectId: milestone.projectId,
        projectName: project?.name ?? "Unknown Project",
      }),
    );

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return {
    ...milestone,
    budget: milestone.budget,
    spend: milestone.spend,
    files: [],
    siteUpdates: [],
    tradieSchedules: [],
  };
}

/** Attach uploaded files to a milestone. */
export async function addPhotosToMilestone(
  projectId: string,
  milestoneId: string,
  fileIds: string[],
) {
  const principal = await currentPrincipal();

  const attached = await attachMilestonePhotos(
    principal,
    { fileIds, milestoneId },
    prisma,
  );

  const addedFiles = await prisma.file.findMany({
    where: { id: { in: [...attached.fileIds] } },
  });

  after(async () => {
    const project = await prisma.project.findUnique({
      where: { id: attached.projectId },
      select: { name: true },
    });

    await logAction(
      {
        ...createActivityLogEntry("newMilestonePhotoUploaded", {
          fileCount: addedFiles.length,
          milestoneId: attached.milestoneId,
          milestoneName: attached.milestoneName,
          projectId: attached.projectId,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );

    await triggerNotification(
      await milestoneAudience(attached.siteManagerId),
      createNotification("newMilestonePhotoUploaded", {
        fileCount: addedFiles.length,
        milestoneId: attached.milestoneId,
        milestoneName: attached.milestoneName,
        projectId: attached.projectId,
        projectName: project?.name ?? "Unknown Project",
      }),
    );

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return { id: milestoneId, projectId: attached.projectId, files: addedFiles };
}

/**
 * Update a milestone and everything it implies for the project.
 *
 * The whole database side — milestone row, parent roll-up, project spend and
 * status — is one transaction now. It used to be the milestone row inside the
 * request and the rest inside `after()`, so a failure after the response left a
 * completed milestone whose parent was still open and whose project spend was
 * stale, with nobody to tell.
 *
 * The progress claim stays in `after()` deliberately: it calls Xero, and a
 * lapsed connection must not roll back a completion the operator already saw
 * succeed. `ensureStageInvoice` swallows its own errors and is safe to repeat.
 */
export async function updateMilestone(
  milestoneId: string,
  updateData: MilestoneUpdateData,
) {
  const principal = await currentPrincipal();

  const outcome = await prisma.$transaction((tx) =>
    updateMilestoneCommand(
      principal,
      {
        actualDate: updateData.actualDate,
        milestoneId,
        spend: updateData.spend,
        startDate: updateData.startDate,
        status: updateData.status,
        targetDate: updateData.targetDate,
      },
      tx,
    ),
  );

  after(async () => {
    if (outcome.stageClaim) {
      await ensureStageInvoice(
        outcome.stageClaim.projectId,
        outcome.milestone.id,
      );
    }

    await logAction(
      {
        ...createActivityLogEntry("milestoneStatusChanged", {
          milestoneId: outcome.milestone.id,
          milestoneName: outcome.milestone.name,
          newStatus: outcome.milestone.status,
          oldStatus: outcome.milestone.previousStatus,
          projectId: outcome.milestone.projectId,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );

    await triggerNotification(
      await milestoneAudience(outcome.siteManagerId),
      createNotification("milestoneStatusChanged", {
        milestoneId: outcome.milestone.id,
        milestoneName: outcome.milestone.name,
        newStatus: outcome.milestone.status,
        oldStatus: outcome.milestone.previousStatus,
        projectId: outcome.milestone.projectId,
      }),
    );

    revalidateTag(
      `project-${outcome.milestone.projectId}`,
      CACHE_PROFILES.MEDIUM,
    );
  });

  return {
    ...outcome.milestone,
    budget: outcome.milestone.budget,
    spend: outcome.milestone.spend,
  };
}

/**
 * Seed a project's milestones from the template.
 *
 * Kept as a named re-export so the offer handoff and the creation command
 * reach the same function; the rule itself is in the domain.
 */
export async function createMilestonesFromTemplateForProject(
  projectId: string,
  startDate: Date,
  costLines?: readonly OfferWorkspaceCostLine[],
  tx?: Prisma.TransactionClient,
) {
  const { created } = await createMilestonesFromTemplate(
    { costLines, projectId, startDate },
    tx ?? prisma,
  );
  return { message: `Created ${created} milestones for project ${projectId}` };
}
