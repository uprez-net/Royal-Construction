export const DASHBOARD_PROJECT_PAGE_SIZE = 10;

/**
 * The `/api/projects` request behind the dashboard's Active Project Overview.
 * The first render (`app/(main)/dashboard/page.tsx`) reads `status: "ACTIVE"`
 * with the default order, so this sends the same filter and page size, plus the
 * search box. The route scopes the rows to the caller, as the first render does.
 */
export function dashboardProjectsUrl({
  page,
  search,
}: {
  page: number;
  search: string;
}): string {
  const params = new URLSearchParams({
    status: "ACTIVE",
    page: String(page),
    limit: String(DASHBOARD_PROJECT_PAGE_SIZE),
  });
  const term = search.trim();
  if (term) params.set("search", term);
  return `/api/projects?${params.toString()}`;
}
