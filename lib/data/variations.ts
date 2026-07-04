import prisma from "@/lib/prisma";
import { VariationStatus } from "@prisma/client";
import { applyVariationDelay } from "@/lib/utils/apply-variation-delay";
import type { CreateVariationInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { after } from "next/server";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import { currency } from "@/utils/formatters";

type VariationStatusInput = "APPROVED" | "REJECTED";
/**
 * Creates a new project variation request.
 *
 * A newly created variation is always initialized with a `PENDING` status.
 * After the database transaction completes, this function:
 * - Notifies the assigned site manager about the new variation.
 * - Revalidates the project's cache.
 *
 * Decimal values are converted to strings before returning to ensure safe
 * serialization across the server/client boundary.
 *
 * @param projectId - ID of the project the variation belongs to.
 * @param input - Validated variation creation payload.
 * @returns The newly created variation with its cost serialized as a string.
 */
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

  after(async () => {
    const siteManagerId = project.siteManagerId;
    const notificationPayload = createNotification("variationCreated", {
      projectId: variation.projectId,
      projectName: project.name,
      variationDescription: variation.description,
      variationAmount: variation.cost.toString(),
    });
    const activityLogEntry = createActivityLogEntry("variationCreated", {
      projectId: variation.projectId,
      projectName: project.name,
      variationDescription: variation.description,
      variationAmount: currency.format(parseFloat(variation.cost.toString())),
    });
    await logAction(activityLogEntry);
    await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  })

  return {
    ...variation,
    cost: variation.cost.toString(),
  };
}

/**
 * Updates the approval status of an existing project variation.
 *
 * Depending on the supplied status, this function:
 * - Marks the variation as approved or rejected.
 * - Sets or clears the approval date.
 * - Notifies the assigned site manager of the status change.
 * - Applies project schedule delays for approved variations.
 * - Revalidates the associated project cache.
 *
 * If the variation is approved, any milestone or project delays associated
 * with the variation are automatically applied via `applyVariationDelay`.
 *
 * @param variationId - ID of the variation to update.
 * @param status - New variation status (`APPROVED` or `REJECTED`).
 * @returns The updated variation.
 *
 * @throws Re-throws any database or delay application errors encountered during execution.
 */
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

  after(async () => {
    const siteManagerId = project.siteManagerId;

    const notificationPayload = createNotification("variationUpdated", {
      projectId: variation.projectId,
      projectName: project.name,
      variationDescription: variation.description,
      variationAmount: variation.cost.toString(),
      status: variation.status,
    });
    const activityLogEntry = createActivityLogEntry("variationUpdated", {
      projectId: variation.projectId,
      projectName: project.name,
      variationDescription: variation.description,
      variationAmount: currency.format(parseFloat(variation.cost.toString())),
      status: variation.status,
    });
    await logAction(activityLogEntry);
    await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);

    if (status === "APPROVED") {
      await applyVariationDelay(variation.id);
    }
    revalidateTag(`project-${variation.projectId}`, CACHE_PROFILES.MEDIUM);
  })

  return variation;
}
