import { getCachedProjectById } from "@/lib/data/projects";
import { parseRouteParamsWithResponse, successResponse, notFoundResponse } from "@/utils/validators";
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

  const project = await getCachedProjectById(routeParams.data.projectId);
  if (!project) {
    return notFoundResponse("Project");
  }

  return successResponse(project);
}
