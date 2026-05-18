import { getCachedProjectById } from "@/lib/data/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const project = await getCachedProjectById(projectId);
  if (!project) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(project);
}
