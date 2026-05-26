import prisma from "@/lib/prisma";
import { VariationStatus } from "@prisma/client";
import { applyVariationDelay } from "@/lib/utils/apply-variation-delay";
import type { CreateVariationInput } from "@/utils/validators";

type VariationStatusInput = "APPROVED" | "REJECTED";

export async function createVariation(projectId: string, input: CreateVariationInput) {
  const variation = await prisma.variation.create({
    data: {
      projectId,
      description: input.description,
      cost: input.cost,
      requestedDate: input.requestedDate ?? new Date(),
      status: VariationStatus.PENDING,
    },
  });

  return {
    ...variation,
    cost: variation.cost.toString(),
  };
}

export async function updateVariationStatus(variationId: string, status: VariationStatusInput) {
  const variation = await prisma.variation.update({
    where: { id: variationId },
    data: status === "APPROVED" ? { status: VariationStatus.APPROVED, approvedDate: new Date() } : { status: VariationStatus.REJECTED, approvedDate: null },
  });

  if (status === "APPROVED") {
    await applyVariationDelay(variation.id);
  }

  return variation;
}
