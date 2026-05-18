import { VariationStatus } from "@prisma/client";

import { getProjectById } from "@/lib/data/projects";
import prisma from "@/lib/prisma";
import { revalidateTag } from "next/cache";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const body = (await request.json()) as {
    description?: string;
    cost?: number;
    requestedDate?: string;
  };

  if (!body.description || typeof body.cost !== "number") {
    return new Response("Invalid variation payload", { status: 400 });
  }

  await prisma.variation.create({
    data: {
      projectId: projectId,
      description: body.description,
      cost: body.cost,
      requestedDate: body.requestedDate ? new Date(body.requestedDate) : new Date(),
      status: VariationStatus.PENDING,
    },
  });

  revalidateTag("projects", "max");

  const updatedProject = await getProjectById(projectId);

  if (!updatedProject) {
    return new Response("Project not found after creating variation", { status: 404 });
  }

  return Response.json(updatedProject);
}
