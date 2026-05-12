import { auth } from "@clerk/nextjs/server";
import { VariationStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: { projectId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    description?: string;
    cost?: number;
    requestedDate?: string;
  };

  if (!body.description || typeof body.cost !== "number") {
    return new Response("Invalid variation payload", { status: 400 });
  }

  const variation = await prisma.variation.create({
    data: {
      projectId: params.projectId,
      description: body.description,
      cost: body.cost,
      requestedDate: body.requestedDate ? new Date(body.requestedDate) : new Date(),
      status: VariationStatus.PENDING,
    },
  });

  return Response.json(variation);
}
