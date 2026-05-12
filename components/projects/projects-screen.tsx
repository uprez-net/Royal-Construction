import { ProjectsClient } from "./projects-client";
import { getCachedProjectKPIs, getCachedProjects } from "@/lib/data/projects";

export async function ProjectsScreen({
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [projects, kpis] = await Promise.all([getCachedProjects(), getCachedProjectKPIs()]);

  return <ProjectsClient projects={projects} kpis={kpis} />;
}
