import { ProjectsClient } from "@/components/projects/projects-client";
import { getCachedProjectKPIs, getCachedProjects } from "@/lib/data/projects";

export default async function ProjectPage() {
  const [projects, kpis] = await Promise.all([
    getCachedProjects(),
    getCachedProjectKPIs(),
  ]);

  return <ProjectsClient projects={projects} kpis={kpis} />;
}
