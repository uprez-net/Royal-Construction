import { addDays, differenceInCalendarDays } from "date-fns";
import { VariationStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function applyVariationDelay(variationId: string): Promise<void> {
  const variation = await prisma.variation.findUnique({
    where: { id: variationId },
    include: {
      project: {
        include: {
          milestones: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              order: true,
              status: true,
              targetDate: true,
            },
          },
        },
      },
    },
  });

  if (!variation) {
    throw new Error("Variation not found");
  }

  if (variation.status !== VariationStatus.APPROVED || !variation.approvedDate) {
    throw new Error("Variation must be approved before delay can be applied");
  }

  const delayDays = differenceInCalendarDays(variation.approvedDate, variation.requestedDate);
  const activeMilestone = variation.project.milestones.find((milestone) => milestone.status === "ACTIVE");
  const activeOrder = activeMilestone?.order ?? 0;

  await prisma.$transaction(async (tx) => {
    await tx.variation.update({
      where: { id: variationId },
      data: { delayDays },
    });

    const pendingMilestones = variation.project.milestones.filter(
      (milestone) => milestone.status === "PENDING" && milestone.order > activeOrder,
    );

    for (const milestone of pendingMilestones) {
      await tx.milestone.update({
        where: { id: milestone.id },
        data: {
          targetDate: addDays(milestone.targetDate, delayDays),
        },
      });
    }

    await tx.project.update({
      where: { id: variation.projectId },
      data: {
        estimatedEndDate: addDays(variation.project.estimatedEndDate, delayDays),
      },
    });
  });
}
