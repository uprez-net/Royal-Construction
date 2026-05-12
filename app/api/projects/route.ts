import { auth } from "@clerk/nextjs/server";
import { ProjectStatus } from "@prisma/client";

import { getProjects } from "@/lib/data/projects";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const projectStatus = status && Object.values(ProjectStatus).includes(status as ProjectStatus) ? (status as ProjectStatus) : undefined;
  const projects = await getProjects(projectStatus ? { status: projectStatus } : undefined);

  return Response.json(projects);
}
