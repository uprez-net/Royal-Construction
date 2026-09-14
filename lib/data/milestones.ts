import prisma from "@/lib/prisma";
import { MilestoneStatus, Prisma } from "@prisma/client";
import type { MilestoneCreationData, MilestoneUpdateData } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { milestoneTemplates } from "@/constants/milestoneTemplate";
import { v4 as randomUUID } from "uuid";
import { addDays } from "date-fns";
import { ensureStageInvoice } from "./invoice";
import { after } from "next/server";
import { createActivityLogEntry } from "@/types/activityLog";
import { createNotification } from "@/types/notification";
import { logAction } from "./actionLog";
import { triggerNotification } from "../notification/novu";
import { getAllAdminUsersIds } from "./user";
import { OfferWorkspaceCostLine } from "../offer/workspace-model";

/**
 * Retrieves all milestones for a project ordered by their display order.
 *
 * @param projectId - The ID of the project.
 * @returns A list of milestones containing their ID, name, status, photo requirement, and display order.
 * @throws {Error} If the database query fails.
 */
export async function getMilestonesByProject(projectId: string) {
  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isPhotoRequired: true,
      status: true,
      order: true,
    },
  });

  return milestones;
}

/**
 * Creates a new milestone for a project.
 *
 * If a parent milestone is provided, the new milestone is inserted
 * immediately after the parent in the milestone sequence. All subsequent
 * milestones have their order incremented to preserve a contiguous ordering.
 * If no parent is provided, the milestone is appended to the end of the
 * project's milestone queue.
 *
 * The operation is executed within a transaction to ensure milestone ordering
 * remains consistent, and the project's cache is revalidated after creation.
 *
 * @param projectId - The ID of the project the milestone belongs to.
 * @param data - The milestone creation payload.
 * @returns The newly created milestone with decimal fields serialized as strings.
 * @throws {Error} If the specified parent milestone does not exist or the milestone cannot be created.
 */
export async function createMilestone(projectId: string, data: MilestoneCreationData) {
  const newMilestone = await prisma.$transaction(async (tx) => {
    let order: number;

    if (data.parentId) {
      const parentMilestone = await tx.milestone.findUnique({
        where: { id: data.parentId },
        select: {
          order: true,
          status: true,
          childrenMilestones: {
            select: { order: true },
            orderBy: { order: "asc" },
          },
        },
      });

      if (!parentMilestone) {
        throw new Error("Parent milestone not found");
      }

      order = parentMilestone.childrenMilestones.length > 0
        ? parentMilestone.childrenMilestones[
          parentMilestone.childrenMilestones.length - 1
        ].order + 1
        : parentMilestone.order + 1;

      if (parentMilestone.status === "ACTIVE") {
        await tx.milestone.update({
          where: { id: data.parentId },
          data: {
            status: "PENDING",
          },
        });
      }

      // Shift all milestones after the insertion point.
      const milestonesToShift = await tx.milestone.findMany({
        where: {
          projectId,
          order: {
            gte: order,
          },
        },
        orderBy: {
          order: "desc",
        },
        select: {
          id: true,
          order: true,
        },
      });

      for (const milestone of milestonesToShift) {
        await tx.milestone.update({
          where: {
            id: milestone.id,
          },
          data: {
            order: milestone.order + 1,
          },
        });
      }
    } else {
      // Append to the end.
      order = (await tx.milestone.count({ where: { projectId, projectStage: data.projectStage } })) + 1;
      // Shift all milestones after the insertion point.
      const milestonesToShift = await tx.milestone.findMany({
        where: {
          projectId,
          order: {
            gte: order,
          },
        },
        orderBy: {
          order: "desc",
        },
        select: {
          id: true,
          order: true,
        },
      });

      for (const milestone of milestonesToShift) {
        await tx.milestone.update({
          where: {
            id: milestone.id,
          },
          data: {
            order: milestone.order + 1,
          },
        });
      }
    }

    return tx.milestone.create({
      data: {
        name: data.name,
        description: data.description,
        targetDate: new Date(data.targetDate),
        budget: new Prisma.Decimal(data.budget),
        order,
        projectId,
        parentId: data.parentId,
        projectStage: data.projectStage,
      },
    });
  });

  after(async () => {
    const projectName = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, siteManagerId: true },
    });

    const activityPayload = createActivityLogEntry("milestoneAdded", {
      projectId: newMilestone.projectId,
      milestoneId: newMilestone.id,
      milestoneName: newMilestone.name,
    });

    const notificationPayload = createNotification("milestoneAdded", {
      projectId: newMilestone.projectId,
      milestoneId: newMilestone.id,
      milestoneName: newMilestone.name,
      projectName: projectName?.name ?? "Unknown Project",
    });

    await logAction(activityPayload);

    await triggerNotification(
      projectName?.siteManagerId
        ? [projectName.siteManagerId, ...(await getAllAdminUsersIds())]
        : await getAllAdminUsersIds(),
      notificationPayload,
    );

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return {
    ...newMilestone,
    budget: newMilestone.budget.toString(),
    spend: newMilestone.spend?.toString(),
    files: [],
    siteUpdates: [],
    tradieSchedules: [],
  };
}

/**
 * Associates one or more uploaded files with a milestone.
 *
 * Connects the supplied file records to the milestone, revalidates the
 * project's cache, and returns the newly attached files.
 *
 * @param projectId - The ID of the project containing the milestone.
 * @param milestoneId - The ID of the milestone.
 * @param fileIds - The IDs of the files to attach.
 * @returns An object containing the milestone ID, project ID, and attached files.
 * @throws {Error} If the milestone update or file lookup fails.
 */
export async function addPhotosToMilestone(projectId: string, milestoneId: string, fileIds: string[]) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const updatedMilestone = await prisma.milestone.update({ where: { id: milestoneId }, data: { files: { connect: fileIds.map((id) => ({ id })) } } });

  const addedFiles = await prisma.file.findMany({ where: { id: { in: fileIds } } });

  after(async () => {
    const projectName = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, siteManagerId: true } });
    const activityPayload = createActivityLogEntry("newMilestonePhotoUploaded", {
      projectId: updatedMilestone.projectId,
      milestoneId: updatedMilestone.id,
      milestoneName: updatedMilestone.name,
      fileCount: addedFiles.length,
    });
    const notificationPayload = createNotification("newMilestonePhotoUploaded", {
      projectId: updatedMilestone.projectId,
      milestoneId: updatedMilestone.id,
      milestoneName: updatedMilestone.name,
      projectName: projectName?.name ?? "Unknown Project",
      fileCount: addedFiles.length,
    });
    await logAction(activityPayload);
    await triggerNotification(
      projectName?.siteManagerId ?
        [projectName.siteManagerId, ...(await getAllAdminUsersIds())] :
        await getAllAdminUsersIds(), notificationPayload
    );

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  })

  return { id: milestoneId, projectId, files: addedFiles };
}

const MILESTONE_STATE_MACHINE: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["ACTIVE", "NOT_REQUIRED"],
  ACTIVE: ["DONE"],
  DONE: ["DONE"],
  NOT_REQUIRED: ["PENDING"],
}

/**
 * Updates an existing milestone.
 *
 * Performs milestone status validation, normalizes date fields, updates the
 * milestone, and schedules follow-up work to:
 * - propagate status changes to parent milestones,
 * - recalculate project spending,
 * - create activity log entries,
 * - send notifications, and
 * - revalidate the project cache.
 *
 * Status transitions are validated using the milestone state machine.
 *
 * @param milestoneId - The ID of the milestone to update.
 * @param updateData - The fields to update.
 * @returns The updated milestone with decimal fields serialized as strings.
 * @throws {Error} If the milestone does not exist.
 * @throws {Error} If the requested status transition is invalid.
 */
export async function updateMilestone(milestoneId: string, updateData: MilestoneUpdateData) {
  const normalizedUpdateData = {
    ...updateData,
    targetDate: updateData.targetDate ? new Date(updateData.targetDate) : undefined,
    startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
    actualDate: updateData.actualDate ? new Date(updateData.actualDate) : undefined,
  };
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) {
    throw new Error(`Milestone with ID ${milestoneId} not found.`);
  }

  // Staying put is always allowed: an update that leaves the status alone is
  // editing something else — a target date most often — and the state machine
  // describes which *moves* are legal, not whether a milestone may be touched.
  const isStatusChange =
    updateData.status != null && updateData.status !== milestone.status;

  if (isStatusChange && !MILESTONE_STATE_MACHINE[milestone.status].includes(updateData.status!)) {
    throw new Error(`Invalid status transition from ${milestone.status} to ${updateData.status}.`);
  }

  const updated = await prisma.milestone.update({ where: { id: milestoneId }, data: normalizedUpdateData });

  after(async () => {
    if (updated.parentId) {
      if (updateData.status === "DONE" || updateData.status === "NOT_REQUIRED") {
        const allChildrenMilestonesNotCompleted = await prisma.milestone.findMany({
          where: {
            parentId: updated.parentId,
            status: { not: { in: ["DONE", "NOT_REQUIRED"] } },
          },
        });
        const allChildrenMilestone = await prisma.milestone.findMany({
          where: {
            parentId: updated.parentId,
          },
        });
        const allChildrenWereNotRequired = await prisma.milestone.findMany({
          where: {
            parentId: updated.parentId,
            status: "NOT_REQUIRED",
          },
        });

        if (allChildrenMilestonesNotCompleted.length === 0) {
          const childrenSpent = await prisma.milestone.aggregate({
            where: { parentId: updated.parentId },
            _sum: { spend: true },
          });
          await prisma.milestone.update({
            where: { id: updated.parentId },
            data: {
              status: allChildrenWereNotRequired.length === allChildrenMilestone.length ? "NOT_REQUIRED" : "DONE",
              spend: childrenSpent._sum.spend ?? undefined,
              actualDate: normalizedUpdateData.actualDate,
            },
          });
        }
      }
      else if (updateData.status === "ACTIVE") {
        const parentMilestone = await prisma.milestone.findUnique({ where: { id: updated.parentId } });
        if (parentMilestone && parentMilestone.status !== "ACTIVE") {
          await prisma.milestone.update({
            where: { id: updated.parentId },
            data: {
              status: "ACTIVE",
              startDate: normalizedUpdateData.startDate,
            },
          });
        }
      }
    }
    const allParentMilestoneSpent = await prisma.milestone.aggregate({
      where: { projectId: updated.projectId, parentId: null },
      _sum: { spend: true },
    });
    const pendingMilestones = await prisma.milestone.count({
      where: { projectId: updated.projectId, status: "PENDING" },
    });
    // What this milestone update means for the project's own status.
    //
    // This used to be `pendingMilestones > 0 ? "ACTIVE" : "COMPLETED"`, which
    // was defensible while every project was created ACTIVE: the first branch
    // could only ever re-assert what was already true. It stopped being
    // defensible when projects started life as DRAFT and climbed a compliance
    // ladder before the build — editing a milestone's budget on a project whose
    // certifier had not been engaged would have declared the build under way,
    // and it would have quietly cleared a NEEDS_ATTENTION flag somebody had put
    // there on purpose.
    //
    // So the two ends are stated separately and neither infers the other. No
    // pending milestones means the build is finished. A milestone actually
    // being started means it has begun — the one event that ends the compliance
    // stage — and every other update leaves the status alone, because a spend
    // correction is not a statement about where the job is up to.
    const projectStatus =
      pendingMilestones === 0
        ? ("COMPLETED" as const)
        : updateData.status === "ACTIVE"
          ? ("ACTIVE" as const)
          : undefined;

    const projectUpdate = await prisma.project.update({
      where: { id: updated.projectId },
      data: {
        spent: allParentMilestoneSpent._sum.spend ?? undefined,
        ...(projectStatus ? { status: projectStatus } : {}),
      },
    });

    // A settled milestone can be the one that finishes its stage, which is what
    // a progress claim is raised against. The milestone id, not its
    // `projectStage`: a sub-activity can carry a different stage from the root
    // it hangs off, and the stage it completes is the root's. Guarded and
    // idempotent inside, and it swallows its own errors — an unreachable Xero
    // must not surface as a failed milestone update, since the milestone itself
    // is already committed.
    if (
      updateData.status === MilestoneStatus.DONE ||
      updateData.status === MilestoneStatus.NOT_REQUIRED
    ) {
      await ensureStageInvoice(updated.projectId, updated.id);
    }

    const activityPayload = createActivityLogEntry("milestoneStatusChanged", {
      projectId: updated.projectId,
      milestoneId: updated.id,
      milestoneName: updated.name,
      oldStatus: updated.status,
      newStatus: normalizedUpdateData.status,
    });
    const notificationPayload = createNotification("milestoneStatusChanged", {
      projectId: updated.projectId,
      milestoneId: updated.id,
      milestoneName: updated.name,
      oldStatus: updated.status,
      newStatus: normalizedUpdateData.status,
    });
    await logAction(activityPayload);
    await triggerNotification(
      projectUpdate.siteManagerId ?
        [projectUpdate.siteManagerId, ...(await getAllAdminUsersIds())]
        : await getAllAdminUsersIds(), notificationPayload
    );
    revalidateTag(`project-${updated.projectId}`, CACHE_PROFILES.MEDIUM);
  })

  return {
    ...updated,
    budget: updated.budget.toString(),
    spend: updated.spend?.toString(),
  };
}

/**
 * Creates the default milestone hierarchy for a project from the configured template.
 *
 * Milestones are generated with sequential target dates relative to the
 * supplied project start date. Parent-child relationships are preserved by
 * remapping template IDs to newly generated milestone IDs.
 *
 * If a transaction client is provided, all database operations are executed
 * within that transaction.
 *
 * @param projectId - The ID of the project.
 * @param startDate - The project's starting date used to calculate milestone target dates.
 * @param tx - Optional Prisma transaction client.
 * @returns A message describing how many milestones were created.
 * @throws {Error} If milestone creation fails.
 */
export async function createMilestonesFromTemplateForProject(
  projectId: string,
  startDate: Date,
  costLines?: readonly OfferWorkspaceCostLine[],
  tx?: Prisma.TransactionClient
) {
  try {
    const prismaClient = tx ?? prisma;
    // Build a record of recurring cost lines for each milestone based on the template so that their sum can be equally distributed to the milestones that reference them.
    const costLineMap = milestoneTemplates.reduce((map, template) => {
      template.relatedCostLines?.forEach((costLineName) => {
        map.set(costLineName, (map.get(costLineName) ?? 0) + 1);
      });

      return map;
    }, new Map<string, number>());
    const milestoneRecords = milestoneTemplates.map((template) => {
      const id = randomUUID();

      const calculateMilestoneBudget = (
        relatedCostLines: readonly string[] | undefined,
      ): number => {
        if (!relatedCostLines?.length || !costLines) {
          return 0;
        }

        return costLines
          .filter((costLine) => relatedCostLines.includes(costLine.itemName))
          .reduce((total, costLine) => {
            const referenceCount = costLineMap.get(costLine.itemName) ?? 1;

            return total + costLine.costExGst / referenceCount;
          }, 0);
      };

      return {
        ...template,
        totalBudget: calculateMilestoneBudget(template.relatedCostLines),
        targetDate: addDays(startDate, template.order * 4), // Example: each milestone is 4 days apart based on its order
        id,
      };
    });

    const milestoneIdByOrder = new Map(
      milestoneRecords.map((m) => [m.order, m.id])
    );

    // Do another pass to calculate the parent milestone budgets based on the sum of their children's budgets
    milestoneRecords.forEach((milestone) => {
      if (milestone.parentId) {
        const parentMilestone = milestoneRecords.find((m) => m.id === milestoneIdByOrder.get(milestone.parentId!));
        if (parentMilestone) {
          parentMilestone.totalBudget += milestone.totalBudget;
        }
      }
    });

    const newMilestones = await prismaClient.milestone.createMany({
      data: milestoneRecords.map((milestone) => ({
        id: milestone.id,
        projectId,
        name: milestone.name,
        order: milestone.order,
        targetDate: milestone.targetDate,
        parentId: milestone.parentId
          ? milestoneIdByOrder.get(milestone.parentId)
          : null,
        projectStage: milestone.projectStage,
        budget: new Prisma.Decimal(milestone.totalBudget),
      })),
    });

    return {
      message: `Created ${newMilestones.count} milestones for project ${projectId}`,
    };
  } catch (error) {
    console.error("Error creating milestones from template:", error);
    throw error;
  }
}