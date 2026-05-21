"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Download,
  Plus,
  ToolCaseIcon,
} from "lucide-react";

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
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setProjects } from "@/lib/store/slices/projectsSlice";
import { clearProjectFilters, openModal } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs, ProjectWithStats } from "@/types/project";

import { EnhancedProjectCard } from "./enhanced-project-card";
import { ProjectDetailModal } from "./project-detail-modal";
import { ProjectFilters } from "./project-filters";
import { ProjectToolbar } from "./project-toolbar";
import { fetchJson } from "@/utils/fetch";
import { PaginatedProjectsResult } from "@/lib/data/projects";

const statusConfig: Record<
  string,
  { bg: string; text: string; stripe: string }
> = {
  ON_TRACK: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    stripe: "bg-emerald-500",
  },
  NEEDS_ATTENTION: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    stripe: "bg-amber-500",
  },
  DELAYED: { bg: "bg-red-100", text: "text-red-700", stripe: "bg-red-500" },
  ACTIVE: { bg: "bg-blue-100", text: "text-blue-700", stripe: "bg-blue-500" },
};

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part: string) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function ProjectsClient({
  projects,
  pagination,
  kpis,
}: {
  projects: ProjectWithStats[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  kpis: ProjectKPIs;
}) {
  const dispatch = useAppDispatch();
  const pageInfo = pagination;
  const { projects: projectsInStore, optimisticUpdates } = useAppSelector(
    (state) => state.projects,
  );
  const {
    view,
    status: statusFilter,
    searchQuery,
    sortBy,
    sortOrder,
  } = useAppSelector((state) => state.ui.projectFilters);
  const [currentPage, setCurrentPage] = useState(pagination.page);
  const [isPageLoading, setIsPageLoading] = useState(false);

  const querySignature = `${statusFilter ?? "all"}|${searchQuery.trim()}|${sortBy}|${sortOrder}`;

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

  useEffect(() => {
    dispatch(setProjects(projects));
  }, [projects]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsPageLoading(true);

        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(pageInfo.limit),
          sortBy,
          sortOrder,
        });

        if (statusFilter) params.set("status", statusFilter);
        if (searchQuery.trim()) params.set("search", searchQuery.trim());

        const response = await fetchJson<PaginatedProjectsResult>(
          `/api/projects?${params.toString()}`,
          {
            method: "GET",
          },
          "Unable to load projects",
          controller.signal,
        );
        const data = response.data;

        setCurrentPage(data.page);
        dispatch(setProjects(data.items));
      } catch (error) {
        console.error("Error fetching projects:", error);
      } finally {
        setIsPageLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    currentPage,
    pageInfo.limit,
    querySignature,
    searchQuery,
    sortBy,
    sortOrder,
    statusFilter,
  ]);

  const handleExport = () => {
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
    ];
    const rows = visibleProjects.map((project) => [
      project.name,
      project.customer.name,
      project.location,
      project.siteManager?.name || "—",
      "—",
      project.totalBudget,
      project.spent,
      `${project.progressPercent}%`,
      project.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) =>
            String(cell).includes(",") ? `"${cell}"` : String(cell),
          )
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `projects-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Active"
          value={String(kpis.totalActive)}
          note="Projects currently in active delivery"
          tone="primary"
          icon={ClipboardList}
        />
        <MetricCard
          label="On Track"
          value={String(kpis.onTrack)}
          note="Projects tracking to plan"
          tone="success"
          icon={CheckCircle2}
        />
        <MetricCard
          label="Needs Attention"
          value={String(kpis.needsAttention)}
          note="Projects with live issues or blockers"
          tone="warning"
          icon={AlertTriangle}
        />
        <MetricCard
          label="Delayed"
          value={String(kpis.delayed)}
          note="Projects past the current window"
          tone="danger"
          icon={CircleDot}
        />
      </div>

      <SectionCard
        title="Active Projects"
        description="Manage all construction projects - click card for quick view, or hit Details for full page"
        action={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              type="button"
              onClick={() => dispatch(openModal({ type: "createProject" }))}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <ProjectFilters
            kpis={kpis}
            activeFilter={statusFilter}
            onFilterChange={() => setCurrentPage(1)}
          />
          <ProjectToolbar onSearchChange={() => setCurrentPage(1)} />

          {isPageLoading ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Loading projects...
            </div>
          ) : null}

          {visibleProjects.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 py-12 px-6 text-center">
              <div className="text-muted-foreground">
                <p className="text-sm font-medium">No projects found</p>
                <p className="mt-1 text-xs">
                  Try adjusting your filters or search terms
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatch(clearProjectFilters())}
                className="mt-3"
              >
                Clear Filters
              </Button>
            </div>
          ) : isPageLoading ? null : view === "grid" ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {visibleProjects.map((project) => (
                <EnhancedProjectCard
                  key={project.id}
                  project={project}
                  onDetailsClick={(id) => {
                    dispatch(
                      openModal({
                        type: "projectDetail",
                        payload: { project, id },
                      })
                    )
                  }}
                />
              ))}
            </div>
          ) : (
            <DataTable
              headers={[
                "Project",
                "Client",
                "Location",
                "Budget",
                "Spent",
                "Progress",
                "Status",
              ]}
              rows={visibleProjects.map((project) => [
                <div key={`name-${project.id}`}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium text-teal-600 hover:text-teal-700 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {project.name}
                  </Link>
                </div>,
                <div key={`client-${project.id}`}>{project.customer.name}</div>,
                <div key={`loc-${project.id}`}>{project.location}</div>,
                <div key={`budget-${project.id}`} className="font-mono">
                  ${Math.round(Number(project.totalBudget) / 1000)}K
                </div>,
                <div key={`spent-${project.id}`} className="font-mono">
                  ${Math.round(Number(project.spent) / 1000)}K
                </div>,
                <div key={`prog-${project.id}`}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-teal-500"
                        style={{ width: `${project.progressPercent}%` }}
                      />
                    </div>
                    <span className="font-mono font-semibold">
                      {project.progressPercent}%
                    </span>
                  </div>
                </div>,
                <div key={`status-${project.id}`}>
                  <Badge
                    className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${(statusConfig[project.status] ?? statusConfig.ACTIVE).bg} ${(statusConfig[project.status] ?? statusConfig.ACTIVE).text}`}
                  >
                    {formatStatus(project.status)}
                  </Badge>
                </div>,
              ])}
              onRowClick={(rowIndex) => {
                const project = visibleProjects[rowIndex];
                if (project) {
                  dispatch(
                    openModal({
                      type: "projectDetail",
                      payload: { project },
                    })
                  );
                }
              }}
              emptyState={
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="flex size-12 items-center justify-center">
                      <ToolCaseIcon className="size-5 text-muted-foreground" />
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        No Project data available
                      </p>

                      <p className="text-xs text-muted-foreground">
                        Your Projects will appear here.
                      </p>
                    </div>
                  </div>
              }
            />
          )}

          {pageInfo.totalCount > 0 ? (
            <div className="space-y-3 pt-2">
              <div className="text-center text-xs text-muted-foreground">
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
                        setCurrentPage((page) => Math.max(1, page - 1));
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
                            setCurrentPage(item);
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
                        setCurrentPage((page) =>
                          Math.min(pageInfo.totalPages, page + 1),
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
