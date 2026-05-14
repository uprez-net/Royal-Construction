import { VariationStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { applyVariationDelay } from "@/lib/utils/apply-variation-delay";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; variationId: string }> },
) {

  const { projectId, variationId } = await params;

  const body = (await request.json()) as { status?: "APPROVED" | "REJECTED" };

  if (!body.status) {
    return new Response("Status is required", { status: 400 });
  }

  const variation = await prisma.variation.update({
    where: { id: variationId },
    data:
      body.status === "APPROVED"
        ? {
          status: VariationStatus.APPROVED,
          approvedDate: new Date(),
        }
        : {
          status: VariationStatus.REJECTED,
          approvedDate: null,
        },
  });

  if (body.status === "APPROVED") {
    await applyVariationDelay(variation.id);
  }

  return Response.json(variation);
}
