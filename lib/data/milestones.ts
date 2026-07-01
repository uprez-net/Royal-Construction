import prisma from "@/lib/prisma";
import { MilestoneStatus, Prisma } from "@prisma/client";
import type { MilestoneCreationData, MilestoneUpdateData } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { milestoneTemplates } from "@/constants/milestoneTemplate";
import { v4 as randomUUID } from "uuid";
import {
  addDays,
  // addWeeks 
} from "date-fns";
// import { createInvoice } from "./invoice";
// import { dateFormat } from "@/utils/formatters";
import { after } from "next/server";
import { createActivityLogEntry } from "@/types/activityLog";
import { createNotification } from "@/types/notification";
import { logAction } from "./actionLog";
import { triggerNotification } from "../notification/novu";


const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

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
      order = (await tx.milestone.count({ where: { projectId } })) + 1;
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
        ? [projectName.siteManagerId, ADMIN_USER_ID]
        : [ADMIN_USER_ID],
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
    await triggerNotification(projectName?.siteManagerId ? [projectName.siteManagerId, ADMIN_USER_ID] : [ADMIN_USER_ID], notificationPayload);

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  })

  return { id: milestoneId, projectId, files: addedFiles };
}

const MILESTONE_STATE_MACHINE: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["DONE"],
  DONE: [],
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
  let normalizedUpdateData = {
    ...updateData,
    startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
    actualDate: updateData.actualDate ? new Date(updateData.actualDate) : undefined,
    invoiceId: null as string | null, // Ensure invoiceId is set to null if not provided
  };
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) {
    throw new Error(`Milestone with ID ${milestoneId} not found.`);
  }

  if (updateData.status && !MILESTONE_STATE_MACHINE[milestone.status].includes(updateData.status)) {
    throw new Error(`Invalid status transition from ${milestone.status} to ${updateData.status}.`);
  }

  if (updateData.status === "DONE") {
    console.log("Creating invoice for milestone:", milestoneId);
    // Would be handled in future with XERO integration, but for now we will just create a placeholder code
    // const invoiceId = await createInvoice({
    //   milestoneId: milestoneId,
    //   projectId: milestone.projectId,
    //   milestoneAmount: parseFloat(milestone.budget.toString()),
    //   date: dateFormat.format(new Date()),
    //   dueDate: dateFormat.format(addWeeks(new Date(), 2)),
    //   milestoneName: milestone.name,
    // });
    normalizedUpdateData = {
      ...normalizedUpdateData,
      invoiceId: null,
    };
  }
  const updated = await prisma.milestone.update({ where: { id: milestoneId }, data: normalizedUpdateData });

  after(async () => {
    if (updated.parentId) {
      if (updateData.status === "DONE") {
        const allChildrenMilestonesNotCompleted = await prisma.milestone.findMany({
          where: {
            parentId: updated.parentId,
            status: { not: "DONE" },
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
              status: "DONE",
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

    const projectUpdate = await prisma.project.update({
      where: { id: updated.projectId },
      data: {
        spent: allParentMilestoneSpent._sum.spend ?? undefined,
      },
    });

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
    await triggerNotification(projectUpdate.siteManagerId ? [projectUpdate.siteManagerId, ADMIN_USER_ID] : [ADMIN_USER_ID], notificationPayload);
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
  tx?: Prisma.TransactionClient
) {
  try {
    const prismaClient = tx ?? prisma;
    const milestoneRecords = milestoneTemplates.map((template) => {
      const id = randomUUID();

      return {
        ...template,
        targetDate: addDays(startDate, template.order * 4), // Example: each milestone is 4 days apart based on its order
        id,
      };
    });

    const milestoneIdByOrder = new Map(
      milestoneRecords.map((m) => [m.order, m.id])
    );

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