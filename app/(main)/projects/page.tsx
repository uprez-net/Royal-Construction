import { ProjectsClient } from "@/components/projects/projects-client";
import { getProjectKPIs, getProjects } from "@/lib/data/projects";
import { connection } from "next/server";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";

export const metadata: Metadata = {
  title: "Projects Management",
  description: "Manage and track your active construction project effectively.",
};

const projectPageSize = 12;

export default async function ProjectPage() {
  // Render on demand, never at build. Under Cache Components a `'use cache'`
  // fetcher is PREFILLED during `next build`, which runs its DB query at build
  // time -- and CI can't reach Neon, so the build died on ETIMEDOUT. The fix is
  // two parts: (1) read the UNCACHED fetchers so the query happens at request
  // time, and (2) `connection()` to defer this page's render off the build.
  // Mirrors app/(main)/dashboard/page.tsx, which already builds without a DB.
  await connection();
  const [projectsPage, kpis, user] = await Promise.all([
    // Matches the client's default status chip so the first paint is already
    // the list the reader will see, instead of one that narrows when the
    // client's own fetch lands. Unfiltered since the project ladder arrived --
    // see DEFAULT_PROJECT_STATUS_FILTER, which explains why "Active" stopped
    // meaning "in flight".
    getProjects({ page: 1, limit: projectPageSize }),
    getProjectKPIs(),
    auth().then(({ userId }) => userId ? getUserByClerkIdCached(userId) : null),
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
        role={user!.role}
      />
    </>
  );
}
