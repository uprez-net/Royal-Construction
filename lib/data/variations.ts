import prisma from "@/lib/prisma";
import { VariationStatus } from "@prisma/client";
import { applyVariationDelay } from "@/lib/utils/apply-variation-delay";
import type { CreateVariationInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";

type VariationStatusInput = "APPROVED" | "REJECTED";

export async function createVariation(projectId: string, input: CreateVariationInput) {
  const { project, ...variation } = await prisma.variation.create({
    data: {
      projectId,
      description: input.description,
      cost: input.cost,
      requestedDate: input.requestedDate ?? new Date(),
      status: VariationStatus.PENDING,
    },
    include: {
      project: {
        select: { name: true, siteManagerId: true }
      },
    }
  });
  const siteManagerId = project.siteManagerId;
  const notificationPayload = createNotification("variationCreated", {
    projectId: variation.projectId,
    projectName: project.name,
    variationDescription: variation.description,
    variationAmount: variation.cost.toString(),
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return {
    ...variation,
    cost: variation.cost.toString(),
  };
}

export async function updateVariationStatus(variationId: string, status: VariationStatusInput) {
  const { project, ...variation } = await prisma.variation.update({
    where: { id: variationId },
    data: status === "APPROVED" ? { status: VariationStatus.APPROVED, approvedDate: new Date() } : { status: VariationStatus.REJECTED, approvedDate: null },
    include: {
      project: {
        select: { name: true, siteManagerId: true }
      },
    }
  });
  const siteManagerId = project.siteManagerId;

  const notificationPayload = createNotification("variationUpdated", {
    projectId: variation.projectId,
    projectName: project.name,
    variationDescription: variation.description,
    variationAmount: variation.cost.toString(),
    status: variation.status,
  });
  await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

  if (status === "APPROVED") {
    await applyVariationDelay(variation.id);
  }
  revalidateTag(`project-${variation.projectId}`, CACHE_PROFILES.MEDIUM);

  return variation;
}
