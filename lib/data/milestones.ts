import prisma from "@/lib/prisma";
import { MilestoneStatus, Prisma } from "@prisma/client";
import type { MilestoneCreationData, MilestoneUpdateData } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { milestoneTemplates } from "@/constants/milestoneTemplate";
import { v4 as randomUUID } from "uuid";
import { addDays, addWeeks } from "date-fns";
import { createInvoice } from "./invoice";
import { dateFormat } from "@/utils/formatters";

/**
 * Gets all milestones for a given project, ordered by their specified order field. Each milestone includes its id, name, photo requirement status, current status, and order.
 * @param projectId - the ID of the project to fetch milestones for
 * @returns an array of milestones associated with the project
 * @throws Error if database query fails
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
 * Creates a new milestone for a project with the provided data, then triggers cache revalidation for the project to ensure fresh data is served. The new milestone's order is set to one greater than the current count of milestones for the project.
 * @param projectId 
 * @param data 
 * @returns newly created milestone with its details
 * @throws Error if milestone creation fails
 * Also triggers revalidation of the project cache to ensure the new milestone appears in subsequent fetches.
 */
export async function createMilestone(projectId: string, data: MilestoneCreationData) {
  const newMilestone = await prisma.milestone.create({
    data: {
      name: data.name,
      order: await prisma.milestone.count({ where: { projectId } }) + 1,
      description: data.description,
      targetDate: new Date(data.targetDate),
      budget: new Prisma.Decimal(data.budget),
      projectId,
      parentId: data.parentId,
    },
  });


  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

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
 * Adds photos to an existing milestone by connecting file records to the milestone. After updating the milestone, it triggers cache revalidation for the associated project to ensure the new files are reflected in the UI.
 * @param projectId 
 * @param milestoneId 
 * @param fileIds 
 * @returns updated milestone with its associated files
 * @throws Error if database update fails
 * Also triggers revalidation of the project cache to ensure the milestone's new files appear in subsequent fetches.
 */
export async function addPhotosToMilestone(projectId: string, milestoneId: string, fileIds: string[]) {
  await prisma.milestone.update({ where: { id: milestoneId }, data: { files: { connect: fileIds.map((id) => ({ id })) } } });

  const addedFiles = await prisma.file.findMany({ where: { id: { in: fileIds } } });
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return { id: milestoneId, projectId, files: addedFiles };
}

const MILESTONE_STATE_MACHINE: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["DONE"],
  DONE: [],
}

/**
 * Updates an existing milestone with new data. Only the fields provided in the updateData object will be updated. After updating the milestone, it triggers cache revalidation for the associated project to ensure the updated milestone data is reflected in the UI.
 * @param milestoneId 
 * @param updateData 
 * @returns updated milestone with its new details
 * @throws Error if database update fails
 * Also triggers revalidation of the project cache to ensure the updated milestone data appears in subsequent fetches.
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
    const invoiceId = await createInvoice({
      milestoneId: milestoneId,
      projectId: milestone.projectId,
      milestoneAmount: parseFloat(milestone.budget.toString()),
      date: dateFormat.format(new Date()),
      dueDate: dateFormat.format(addWeeks(new Date(), 2)),
      milestoneName: milestone.name,
    });
    normalizedUpdateData = {
      ...normalizedUpdateData,
      invoiceId,
    };
  }
  const updated = await prisma.milestone.update({ where: { id: milestoneId }, data: normalizedUpdateData });

  revalidateTag(`project-${updated.projectId}`, CACHE_PROFILES.MEDIUM);

  return {
    ...updated,
    budget: updated.budget.toString(),
    spend: updated.spend?.toString(),
  };
}

/**
 * Creates milestones for a project based on a template, starting from a specified date.
 * @param projectId - the ID of the project for which to create milestones
 * @param startDate - the date to start creating milestones from
 * @param tx - an optional transaction client for database operations
 * @returns a promise resolving to an object containing the result of the operation
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