import {
  getCachedProjectsForLookup,
  getProjects,
  getProjectsNeedingAttention,
} from "@/lib/data/projects";
import {
  projectListQuerySchema,
  projectLookupQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  // Handle lookup mode
  if (mode === "lookup") {
    const params = parseSearchParamsWithResponse(url, projectLookupQuerySchema);
    if (!params.success) return params.response;

    const result = await getCachedProjectsForLookup(
      params.data.page,
      params.data.limit,
      params.data.q,
    );

    return successResponse(result);
  }

  // Every project needing attention, for the Projects page's Alerts card. Its
  // own read rather than taken from the list's rows, which are one page of
  // one chip: an overdue job on page three is still overdue.
  if (mode === "attention") {
    return successResponse(await getProjectsNeedingAttention());
  }

  // Handle main list mode
  const params = parseSearchParamsWithResponse(url, projectListQuerySchema);
  if (!params.success) return params.response;

  // Uncached, like the page's first render. Each row now carries its live
  // Needs Attention conditions (issue #452), and those turn on the clock (an
  // activity becomes overdue overnight) and on records that never expire the
  // "projects" tag — a compliance alert the cron raises, a checklist defect, a
  // variation. A list cached for "max" would keep reporting a job as fine
  // after it stopped being, which is the silent kind of wrong.
  //
  // A failed read answers 500, not an empty 200 (#486): the Projects list and
  // the dashboard search show "no projects" for an empty page and a failure
  // message for an error, and they could not tell the two apart. getProjects
  try {
    const projects = await getProjects({
      status: params.data.status,
      page: params.data.page,
      limit: params.data.limit,
      search: params.data.search,
      sortBy: params.data.sortBy,
      sortOrder: params.data.sortOrder,
    });

    return successResponse(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return errorResponse("Failed to load projects", {
      status: 500,
      code: "PROJECTS_FETCH_FAILED",
    });
  }
}

/**
 * Creating a project from scratch is not a thing this system does.
 *
 * `Project.leadId` is a required unique foreign key: a project exists only as
 * a converted lead. The handler that used to sit here called
 * `lib/data/projectsWrite.ts#createProject`, which wrote `leadId: 0` with the
 * comment "To make this function fail" — so every POST died on a constraint
 * violation and came back as an opaque 500 "Failed to create project". That
 * is the silent-failure shape AGENTS.md calls out: the endpoint looked
 * supported and never was.
 *
 * It answers honestly now, and names the path that works. The create-project
 * wizard posts to `createProjectWithLeadAction`, which runs
 * `lib/domain/projects/creation.ts#createProjectFromLead`.
 */
export async function POST() {
  return errorResponse(
    "A project is created by converting a lead. Use the create-project wizard, which starts from the lead the job came from.",
    { status: 400, code: "PROJECT_REQUIRES_LEAD" },
  );
}
