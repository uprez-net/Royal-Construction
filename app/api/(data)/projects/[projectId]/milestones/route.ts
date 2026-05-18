import prisma from "@/lib/prisma";
import { parseRouteParamsWithResponse, successResponse } from "@/utils/validators";
import { projectParamSchema } from "@/utils/validators/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema
  );
  if (!routeParams.success) return routeParams.response;

  const milestones = await prisma.milestone.findMany({
    where: { projectId: routeParams.data.projectId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isPhotoRequired: true,
      status: true,
      order: true,
    },
  });

  return successResponse(milestones);
}
