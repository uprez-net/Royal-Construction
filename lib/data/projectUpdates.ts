import prisma from "@/lib/prisma";
import type { CreateProjectUpdateInput } from "@/utils/validators";

export async function createProjectUpdate(input: {
  projectId: string;
  authorId: string;
} & CreateProjectUpdateInput) {
  const { projectId, milestoneId, authorId, notes, photoUrls = [] } = input;

  const milestone = milestoneId
    ? await prisma.milestone.findUnique({ where: { id: milestoneId }, select: { id: true, isPhotoRequired: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.siteUpdate.create({
      data: {
        projectId: projectId,
        milestoneId: milestoneId,
        authorId: authorId,
        notes,
        photoUrls,
      },
    });

    await tx.activityLog.create({
      data: {
        projectId: projectId,
        milestoneId: milestoneId,
        authorId: authorId,
        type: "site-update",
        message: `Site update posted for ${projectId}`,
      },
    });

    if (milestone?.isPhotoRequired && milestoneId) {
      await tx.milestone.update({ where: { id: milestoneId }, data: { status: "DONE", actualDate: new Date() } });
    }
  });

  return {
    milestoneWasPhotoRequired: Boolean(milestone?.isPhotoRequired),
  };
}
