import { ProjectsClient } from "@/components/projects/projects-client";
import { getCachedProjectKPIs, getCachedProjects } from "@/lib/data/projects";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects Management",
  description: "Manage and track your active construction project effectively.",
};

const projectPageSize = 12;



export default async function ProjectPage() {
  const [projectsPage, kpis] = await Promise.all([
    getCachedProjects({ page: 1, limit: projectPageSize }),
    getCachedProjectKPIs(),
  ]);

  return <ProjectsClient projects={projectsPage.items} pagination={projectsPage} kpis={kpis} />;
}
