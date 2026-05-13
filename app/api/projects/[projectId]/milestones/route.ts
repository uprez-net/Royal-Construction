import { auth } from "@clerk/nextjs/server";

import prisma from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  const { projectId } = await params;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const milestones = await prisma.milestone.findMany({
    where: { projectId: projectId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isPhotoRequired: true,
      status: true,
      order: true,
    },
  });

  return Response.json(milestones);
}
