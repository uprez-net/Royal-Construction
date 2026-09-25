import { ProjectStatus } from "@prisma/client";
import { PRE_CONSTRUCTION_FILTER } from "@/types/project";
import type {
  ProjectListQuery,
  ProjectListSortBy,
} from "@/lib/domain/projects/queries";

/**
 * The Projects list's place — status chip, page, search and sort — lives in
 * the /projects URL, so coming back from a project lands on the chip the list
 * was on, a reload keeps it, and opening Projects fresh from anywhere else
 * starts over. The same shape as the Leads table (components/leads/leads-list-url.ts):
 *
 *   ?status=ACTIVE    the status chip (absent means "All")
 *   ?page=3           the list page (absent means 1)
 *   ?query=smith      the search box
 *   ?sort=progress    the sort option (absent means name A–Z)
 */
export const PROJECTS_LIST_PARAM_KEYS = [
  "status",
  "page",
  "query",
  "sort",
] as const;

type ProjectsListParamKey = (typeof PROJECTS_LIST_PARAM_KEYS)[number];

/** A value to set, or null/empty to remove the parameter. */
export type ProjectsListParamChanges = Partial<
  Record<ProjectsListParamKey, string | null>
>;

export type ProjectStatusFilter =
  | ProjectStatus
  | typeof PRE_CONSTRUCTION_FILTER
  | null;

export type ProjectsListParams = {
  readonly status: ProjectStatusFilter;
  readonly page: number;
  readonly query: string;
  readonly sort: ProjectListSortBy;
};

type SearchParamsLike = {
  get(name: string): string | null;
  toString(): string;
};

// Each option carries its own direction: the labels promise one ("high to
// low", "newest first"), so the URL names the option and the direction comes
// with it rather than travelling as a second parameter that could disagree.
export const PROJECT_SORT_OPTIONS: readonly {
  label: string;
  value: ProjectListSortBy;
  sortOrder: "asc" | "desc";
}[] = [
  { label: "Name A–Z", value: "name", sortOrder: "asc" },
  { label: "Progress, high to low", value: "progress", sortOrder: "desc" },
  { label: "Budget, high to low", value: "budget", sortOrder: "desc" },
  { label: "Start date, newest first", value: "startDate", sortOrder: "desc" },
  { label: "Spent, high to low", value: "spent", sortOrder: "desc" },
];

/**
 * The status the project list opens on: what a /projects URL with no
 * `?status=` shows.
 *
 * "ACTIVE" until the project ladder existed, on the reading that delivery works
 * out of the in-flight projects and a completed one is noise. That was sound
 * while every project was created ACTIVE and the word meant "not finished". It
 * stopped being sound the moment a project could be DRAFT, COMPLIANCE_STARTED
 * or COMPLIANCE_COMPLETED: those are the jobs somebody is working on right now,
 * and the list would have opened with every one of them hidden.
 *
 * Null — every project — rather than a new "not completed" filter, because the
 * chips already answer that question and the cost of the alternative is
 * backwards: a finished job on the list is a row to scroll past, while a job in
 * compliance that is not on the list is a job nobody can find.
 *
 * Anything that resets the filters has to come back here, so it stays a named
 * constant even though the value is now null.
 */
export const DEFAULT_PROJECT_STATUS_FILTER: ProjectStatusFilter = null;

const DEFAULT_SORT: ProjectListSortBy = "name";

const STATUS_VALUES: readonly string[] = [
  ...Object.values(ProjectStatus),
  PRE_CONSTRUCTION_FILTER,
];

// An unknown status or sort is dropped rather than sent to the API, which
// would ignore it anyway while the chip row showed nothing selected.
function validStatus(value: string | null): ProjectStatusFilter {
  return value && STATUS_VALUES.includes(value)
    ? (value as Exclude<ProjectStatusFilter, null>)
    : DEFAULT_PROJECT_STATUS_FILTER;
}

function validSort(value: string | null): ProjectListSortBy {
  return (
    PROJECT_SORT_OPTIONS.find((option) => option.value === value)?.value
    ?? DEFAULT_SORT
  );
}

export function readProjectsListParams(
  params: Pick<SearchParamsLike, "get">,
): ProjectsListParams {
  const page = Number(params.get("page"));
  return {
    status: validStatus(params.get("status")),
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    query: params.get("query")?.trim() ?? "",
    sort: validSort(params.get("sort")),
  };
}

/** What the list asks the server for, given where the URL says it is. */
export function projectsListQuery(
  list: ProjectsListParams,
  limit: number,
): ProjectListQuery {
  const sort =
    PROJECT_SORT_OPTIONS.find((option) => option.value === list.sort)
    ?? PROJECT_SORT_OPTIONS[0];
  return {
    status: list.status,
    page: list.page,
    limit,
    search: list.query,
    sortBy: sort.value,
    sortOrder: sort.sortOrder,
  };
}

/**
 * One string per distinct list, whatever order or junk the URL carried. The
 * page compares the list its server props were rendered for against the one
 * the URL names now, so props from an earlier URL are never shown as this one.
 */
export function projectsListKey(list: ProjectsListParams): string {
  return [list.status ?? "", list.page, list.query, list.sort].join("|");
}

/** The search string ("?…", or "" when empty) after applying `changes`. */
export function withProjectsListParams(
  current: SearchParamsLike,
  changes: ProjectsListParamChanges,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

/**
 * Where "Back to all projects" goes: the list a project was opened from,
 * carried as the project page's `?list=`. Only the list's own keys are kept,
 * so the link can never be pointed anywhere but the Projects list.
 */
export function projectsListHref(listQuery: string | null): string {
  if (!listQuery) return "/projects";
  const source = new URLSearchParams(listQuery);
  const kept = new URLSearchParams();
  for (const key of PROJECTS_LIST_PARAM_KEYS) {
    const value = source.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `/projects?${query}` : "/projects";
}

/** The project page for `projectId`, remembering the list it was opened from. */
export function projectDetailHref(
  projectId: string,
  listQuery: string,
): string {
  const list = new URLSearchParams(projectsListHref(listQuery).split("?")[1]);
  const query = list.toString();
  return query
    ? `/projects/${projectId}?list=${encodeURIComponent(query)}`
    : `/projects/${projectId}`;
}
