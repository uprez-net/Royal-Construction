import prisma from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

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
