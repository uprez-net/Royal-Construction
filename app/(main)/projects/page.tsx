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

  return (
    <>
      {/* The app shell renders the page name only as a breadcrumb, so the
          document has no h1 of its own. Visually hidden keeps the existing
          layout while giving assistive tech the page's top-level heading. */}
      <h1 className="sr-only">Projects</h1>
      <ProjectsClient
        projects={projectsPage.items}
        pagination={projectsPage}
        kpis={kpis}
      />
    </>
  );
}
