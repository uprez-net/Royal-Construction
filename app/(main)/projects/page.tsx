import { ProjectsClient } from "@/components/projects/projects-client";
import {
  getProjectKPIs,
  getProjects,
  getProjectsNeedingAttention,
} from "@/lib/data/projects";
import { connection } from "next/server";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  projectsListKey,
  projectsListQuery,
  readProjectsListParams,
} from "@/components/projects/projects-list-url";

export const metadata: Metadata = {
  title: "Projects Management",
  description: "Manage and track your active construction project effectively.",
};

const projectPageSize = 12;

export default async function ProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Render on demand, never at build. Under Cache Components a `'use cache'`
  // fetcher is PREFILLED during `next build`, which runs its DB query at build
  // time -- and CI can't reach Neon, so the build died on ETIMEDOUT. The fix is
  // two parts: (1) read the UNCACHED fetchers so the query happens at request
  // time, and (2) `connection()` to defer this page's render off the build.
  // Mirrors app/(main)/dashboard/page.tsx, which already builds without a DB.
  await connection();
  // The list's chip, page, search and sort live in the URL, so coming back
  // from a project to /projects?status=ACTIVE paints the Active list rather
  // than every project. Absent, it is the client's default: unfiltered since
  // the project ladder arrived -- see DEFAULT_PROJECT_STATUS_FILTER, which
  // explains why "Active" stopped meaning "in flight".
  const query = await searchParams;
  const list = readProjectsListParams({
    get: (name) => {
      const value = query[name];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });
  const [projectsPage, kpis, attention, user] = await Promise.all([
    getProjects(projectsListQuery(list, projectPageSize)),
    getProjectKPIs(),
    getProjectsNeedingAttention(),
    auth().then(({ userId }) =>
      userId ? getUserByClerkIdCached(userId) : null,
    ),
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
        renderedFor={projectsListKey(list)}
        kpis={kpis}
        attention={attention}
        role={user!.role}
      />
    </>
  );
}
