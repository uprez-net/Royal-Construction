import { auth } from "@clerk/nextjs/server";

import { getProjectById } from "@/lib/data/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  const { projectId } = await params;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(project);
}
