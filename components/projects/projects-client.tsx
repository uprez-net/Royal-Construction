"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Download,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/common/data-table";
import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { downloadWorkbook } from "@/lib/spreadsheet/download-workbook";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setProjects } from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs, ProjectWithStats } from "@/types/project";
import { compareAsc, isBefore } from "date-fns";
import { EnhancedProjectCard } from "./enhanced-project-card";
import { ProjectFilters } from "./project-filters";
import { ProjectToolbar } from "./project-toolbar";
import { formatStatus, projectStatusConfig } from "./project-status";
import {
  DEFAULT_PROJECT_STATUS_FILTER,
  projectDetailHref,
  projectsListKey,
  projectsListQuery,
  readProjectsListParams,
  withProjectsListParams,
  type ProjectsListParamChanges,
} from "./projects-list-url";
import { fetchJson } from "@/utils/fetch";
import { getAllProjectsForExport } from "@/lib/actions/projects";
import type { PaginatedProjectsResult } from "@/lib/data/projects";
import { compactCurrency } from "@/utils/formatters";
import type { Role } from "@prisma/client";

const TABLE_HEADERS = [
  "Project",
  "Client",
  "Location",
  "Budget",
  "Spent",
  "Progress",
  "Status",
];

const TABLE_ALIGN = [
  "start",
  "start",
  "start",
  "end",
  "end",
  "end",
  "start",
] as const;

type ProjectsClientProps = {
  role: Role;
  projects: ProjectWithStats[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  kpis: ProjectKPIs;
  /** `projectsListKey` of the list the server rendered `projects` for. */
  renderedFor: string;
};

export function ProjectsClient(props: ProjectsClientProps) {
  // A fresh visit — the sidebar, "Back to all projects", any link — gets a
  // fresh list (search box included). Browser back/forward keeps the one Next
  // preserved for the hidden page, and changing a chip, page or search only
  // changes search params, which keep this key. The list's place itself is in
  // the URL, the same as the Leads table.
  const { bfcacheId } = useRouter();
  return <ProjectsWorkspace key={bfcacheId} {...props} />;
}

function ProjectsWorkspace({
  role,
  projects,
  pagination,
  kpis,
  renderedFor,
}: ProjectsClientProps) {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The status chip, page, search and sort live in the URL: open a project
  // from the Active chip, come back, and the Active chip is still selected.
  const list = readProjectsListParams(searchParams);
  const listKey = projectsListKey(list);
  const currentPage = list.page;
  const [pageInfo, setPageInfo] = useState(pagination);
  const { projects: projectsInStore, optimisticUpdates } = useAppSelector(
    (state) => state.projects,
  );
  const view = useAppSelector((state) => state.ui.projectFilters.view);
  const [searchTerm, setSearchTerm] = useState(list.query);
  const debouncedSearch = useDebounce(searchTerm, 250);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Hard re-entry guard: `disabled` alone still allows a second call from the
  // toast's Retry action or a rapid double activation before React re-renders.
  const exportInFlightRef = useRef(false);
  // Bumped by the toast's Retry action to re-run the fetch effect.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Measured against the default, not against "no filter at all", so an
  // untouched page never offers "Clear filters" and still shows the
  // "No projects yet" empty state.
  const hasActiveFilters =
    list.status !== DEFAULT_PROJECT_STATUS_FILTER || list.query !== "";

  const visibleProjects = useMemo(() => {
    return projectsInStore.map((project) => {
      const optimisticUpdate = optimisticUpdates[project.id];
      return optimisticUpdate
        ? ({ ...project, ...optimisticUpdate } as ProjectWithStats)
        : project;
    });
  }, [projectsInStore, optimisticUpdates]);

  const paginationItems = useMemo(() => {
    const totalPages = pageInfo.totalPages;

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [currentPage, pageInfo.totalPages]);

  /* ── URL updates ── */
  // The browser's replaceState rather than router.replace: this component
  // loads the list itself, so a chip or a keystroke must not also re-render
  // the server page. Next keeps useSearchParams in step with it. Replace, not
  // push: a chip is not a step the back button should walk through; the entry
  // that matters is the one a project was opened from. Read from
  // window.location so two changes in one tick (a search settling as a chip
  // is clicked) both land.
  const updateListParams = useCallback(
    (changes: ProjectsListParamChanges) => {
      const current = new URLSearchParams(window.location.search);
      window.history.replaceState(
        null,
        "",
        `${pathname}${withProjectsListParams(current, changes)}`,
      );
    },
    [pathname],
  );

  /* ── Search box → ?query= ── */
  useEffect(() => {
    const typed = debouncedSearch.trim();
    if (typed !== list.query) updateListParams({ query: typed, page: null });
    // Only the person's typing drives this; the URL changing under it (a
    // chip, paging) must not write the box back over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The server's list is only this list when it was rendered for this URL.
  // With cacheComponents Next hides /projects while a project is open and
  // re-runs this when it is shown again; by then the chip may have moved on
  // from the one the page was rendered for, and seeding the store with that
  // older list would flash the wrong projects until the fetch lands.
  useEffect(() => {
    if (renderedFor !== listKey) return;
    dispatch(setProjects(projects));
  }, [projects, renderedFor, listKey, dispatch]);

  /* ── Load what the URL describes ── */
  // Also re-runs when the page is shown again after a project, so a status
  // changed there shows up in the list.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setIsPageLoading(true);

        const query = projectsListQuery(list, pageInfo.limit);
        const params = new URLSearchParams({
          page: String(query.page),
          limit: String(query.limit),
          sortBy: query.sortBy ?? "name",
          sortOrder: query.sortOrder ?? "asc",
        });

        if (query.status) params.set("status", query.status);
        if (query.search) params.set("search", query.search);

        const response = await fetchJson<PaginatedProjectsResult>(
          `/api/projects?${params.toString()}`,
          {
            method: "GET",
          },
          "Unable to load projects",
          controller.signal,
        );
        const data = response.data;

        dispatch(setProjects(data.items));
        setPageInfo(data);
        setIsPageLoading(false);
        // A remembered page past the end is answered with the last real one;
        // put that in the URL too, or the link a project is opened from, and a
        // reload, would carry a page the list is not on.
        if (data.page !== list.page) {
          updateListParams({ page: data.page > 1 ? String(data.page) : null });
        }
      } catch (error) {
        // An abort is this effect superseding itself, not a failure, and the
        // request that superseded it owns the loading state.
        if (error instanceof Error && error.name === "AbortError") return;

        setIsPageLoading(false);
        console.error("Error fetching projects:", error);
        toast.error("Couldn't refresh projects", {
          description:
            error instanceof Error
              ? `${error.message} The list below may be out of date.`
              : "The list below may be out of date.",
          action: {
            label: "Retry",
            onClick: () => setReloadNonce((nonce) => nonce + 1),
          },
        });
      }
    })();

    return () => controller.abort();
    // `list` is rebuilt every render; listKey is what it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, pageInfo.limit, reloadNonce, dispatch, updateListParams]);

  const goToPage = (page: number) => {
    updateListParams({ page: page > 1 ? String(page) : null });
  };

  const clearFilters = () => {
    setSearchTerm("");
    updateListParams({ status: null, query: null, sort: null, page: null });
  };

  const openQuickView = useCallback(
    (project: ProjectWithStats, isAdmin: boolean) => {
      dispatch(
        openModal({
          type: "projectDetail",
          payload: { project, isAdmin },
        }),
      );
    },
    [dispatch],
  );

  const handleExport = async () => {
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    setIsExporting(true);

    const headers = [
      "Project",
      "Customer",
      "Location",
      "Manager",
      "Stage",
      "Budget",
      "Spent",
      "Progress",
      "Status",
      "Next Up",
    ];

    try {
      const allProjects = await getAllProjectsForExport();
      const rows = allProjects.map((project) => {
        const now = new Date();

        const currentMilestone = project.milestones.find(
          (m) => m.status === "PENDING",
        );

        const nextUpcomingMilestone = project.milestones
          .filter(
            (m) =>
              m.id !== currentMilestone?.id
              && !isBefore(new Date(m.targetDate), now),
          )
          .sort((a, b) =>
            compareAsc(new Date(a.targetDate), new Date(b.targetDate)),
          )
          .at(0);

        return [
          project.name,
          project.customer.name,
          project.location,
          project.siteManager?.name || "—",
          currentMilestone?.name || "—",
          project.totalBudget,
          project.spent,
          `${project.progressPercent}%`,
          formatStatus(project.status),
          nextUpcomingMilestone?.name || "—",
        ];
      });

      await downloadWorkbook(
        [{ name: "Projects Data", rows: [headers, ...rows] }],
        `Royal_Constructions_Projects_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error) {
      console.error("Error exporting projects:", error);
      toast.error("Couldn't export projects", {
        description: "No file was created. Try again in a moment.",
        action: { label: "Retry", onClick: () => void handleExport() },
      });
    } finally {
      exportInFlightRef.current = false;
      setIsExporting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total active"
          value={String(kpis.totalActive)}
          Icon={ClipboardList}
          tone="info"
        />
        <MetricCard
          title="On track"
          value={String(kpis.onTrack)}
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          title="Needs attention"
          value={String(kpis.needsAttention)}
          Icon={AlertTriangle}
          tone="warning"
        />
        <MetricCard
          title="Delayed"
          value={String(kpis.delayed)}
          Icon={CircleDot}
          tone="danger"
        />
      </div>

      <SectionCard
        title="Active projects"
        description="Select a project for a quick view, or Details for the full project page."
        action={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={isExporting}
              aria-busy={isExporting}
              className="gap-2"
            >
              {isExporting ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {isExporting ? "Exporting…" : "Export"}
            </Button>
            <Button
              type="button"
              onClick={() => dispatch(openModal({ type: "createProject" }))}
              className="gap-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New project
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <ProjectFilters
            kpis={kpis}
            activeFilter={list.status}
            onFilterChange={(status) =>
              updateListParams({ status, page: null })
            }
          />
          <ProjectToolbar
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            sort={list.sort}
            onSortChange={(sort) =>
              updateListParams({
                sort: sort === "name" ? null : sort,
                page: null,
              })
            }
          />

          {/* The list stays mounted while a refresh is in flight — dimming keeps
              scroll position, focus and context instead of replacing the
              content with a loading bar on every keystroke. */}
          <div
            aria-busy={isPageLoading}
            className={
              isPageLoading
                ? "opacity-60 transition-opacity motion-reduce:transition-none"
                : "transition-opacity motion-reduce:transition-none"
            }
          >
            {visibleProjects.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center">
                <div className="text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {hasActiveFilters
                      ? "No projects match these filters"
                      : "No projects yet"}
                  </p>
                  <p className="mt-1 text-xs">
                    {hasActiveFilters
                      ? "Widen the status filter or clear the search to see more."
                      : "Projects appear here once a signed offer is handed over to delivery."}
                  </p>
                </div>
                {hasActiveFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="mt-3"
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : view === "grid" ? (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {visibleProjects.map((project) => (
                  <EnhancedProjectCard
                    key={project.id}
                    role={role}
                    project={project}
                    detailsHref={projectDetailHref(
                      project.id,
                      searchParams.toString(),
                    )}
                    onDetailsClick={() =>
                      openQuickView(project, role === "ADMIN")
                    }
                  />
                ))}
              </div>
            ) : (
              /* No emptyState prop: this branch only renders when
                 visibleProjects.length > 0, so the table can never be empty.
                 The page-level empty state above covers both "no data" and
                 "no matches", and it offers Clear filters. */
              <DataTable
                headers={TABLE_HEADERS}
                align={[...TABLE_ALIGN]}
                caption="Active projects, with budget, spend, progress and delivery status. Select a row to open its quick view."
                rowLabel={(rowIndex) =>
                  `Open ${visibleProjects[rowIndex]?.name ?? "project"}`
                }
                rows={visibleProjects.map((project) => {
                  const budget = Number(project.totalBudget);
                  const spent = Number(project.spent);
                  const progress = Math.max(
                    0,
                    Math.min(100, project.progressPercent ?? 0),
                  );
                  const status = projectStatusConfig(project.status);

                  return [
                    <Link
                      key={`name-${project.id}`}
                      href={projectDetailHref(
                        project.id,
                        searchParams.toString(),
                      )}
                      className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {project.name}
                    </Link>,
                    <span key={`client-${project.id}`}>
                      {project.customer.name}
                    </span>,
                    <span key={`loc-${project.id}`}>{project.location}</span>,
                    <span
                      key={`budget-${project.id}`}
                      className="font-mono tabular-nums"
                    >
                      {Number.isFinite(budget)
                        ? compactCurrency.format(budget)
                        : "—"}
                    </span>,
                    <span
                      key={`spent-${project.id}`}
                      className="font-mono tabular-nums"
                    >
                      {Number.isFinite(spent)
                        ? compactCurrency.format(spent)
                        : "—"}
                    </span>,
                    <span
                      key={`prog-${project.id}`}
                      className="inline-flex items-center justify-end gap-2"
                    >
                      <span
                        className="h-2 w-16 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${project.name} progress`}
                      >
                        <span
                          className="block h-full bg-primary"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                      <span className="font-mono font-semibold tabular-nums">
                        {progress}%
                      </span>
                    </span>,
                    <Badge
                      key={`status-${project.id}`}
                      className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${status.badge}`}
                    >
                      {formatStatus(project.status)}
                    </Badge>,
                  ];
                })}
                onRowClick={(rowIndex) => {
                  const project = visibleProjects[rowIndex];
                  if (project) openQuickView(project, role === "ADMIN");
                }}
              />
            )}
          </div>

          {pageInfo.totalCount > 0 ? (
            <div className="space-y-3 pt-2">
              <div
                className="text-center text-xs text-muted-foreground"
                aria-live="polite"
              >
                Showing {visibleProjects.length} of {pageInfo.totalCount}{" "}
                projects
              </div>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        goToPage(Math.max(1, currentPage - 1));
                      }}
                      aria-disabled={currentPage === 1}
                    />
                  </PaginationItem>
                  {paginationItems.map((item, index) =>
                    item === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${index}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          href="#"
                          isActive={item === currentPage}
                          onClick={(event) => {
                            event.preventDefault();
                            goToPage(item);
                          }}
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        goToPage(
                          Math.min(pageInfo.totalPages, currentPage + 1),
                        );
                      }}
                      aria-disabled={currentPage >= pageInfo.totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
