import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { MilestoneCreationData, MilestoneUpdateData } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";

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

export async function addPhotosToMilestone(projectId: string, milestoneId: string, fileIds: string[]) {
  await prisma.milestone.update({ where: { id: milestoneId }, data: { files: { connect: fileIds.map((id) => ({ id })) } } });

  const addedFiles = await prisma.file.findMany({ where: { id: { in: fileIds } } });
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return { id: milestoneId, projectId, files: addedFiles };
}

export async function updateMilestone(milestoneId: string, updateData: MilestoneUpdateData) {
  const normalizedUpdateData = {
    ...updateData,
    startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
    actualDate: updateData.actualDate ? new Date(updateData.actualDate) : undefined,
  };

  const updated = await prisma.milestone.update({ where: { id: milestoneId }, data: normalizedUpdateData });
  revalidateTag(`project-${updated.projectId}`, CACHE_PROFILES.MEDIUM);

  return {
    ...updated,
    budget: updated.budget.toString(),
    spend: updated.spend?.toString(),
  };
}
