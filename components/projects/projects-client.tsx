"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Download,
  Plus,
} from "lucide-react";

import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal, clearProjectFilters } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs, ProjectWithStats } from "@/types/project";
import { setProjects } from "@/lib/store/slices/projectsSlice";
import { ProjectFilters } from "./project-filters";
import { ProjectToolbar } from "./project-toolbar";
import { EnhancedProjectCard } from "./enhanced-project-card";
import { DataTable } from "@/components/common/data-table";
import { ProjectDetailModal } from "./project-detail-modal";
import { Badge } from "../ui/badge";

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
  DELAYED: {
    bg: "bg-red-100",
    text: "text-red-700",
    stripe: "bg-red-500",
  },
  ACTIVE: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    stripe: "bg-blue-500",
  },
};

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function ProjectsClient({
  projects,
  kpis,
}: {
  projects: ProjectWithStats[];
  kpis: ProjectKPIs;
}) {
  const dispatch = useAppDispatch();
  const projectsInStore = useAppSelector((state) => state.projects.projects);
  const view = useAppSelector((state) => state.ui.projectFilters.view);
  const statusFilter = useAppSelector(
    (state) => state.ui.projectFilters.status,
  );
  const searchQuery = useAppSelector(
    (state) => state.ui.projectFilters.searchQuery,
  );
  const sortBy = useAppSelector((state) => state.ui.projectFilters.sortBy);
  const sortOrder = useAppSelector(
    (state) => state.ui.projectFilters.sortOrder,
  );
  const optimisticUpdates = useAppSelector(
    (state) => state.projects.optimisticUpdates,
  );

  const [selectedProject, setSelectedProject] =
    useState<ProjectWithStats | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Filter and sort projects
  const filteredSortedProjects = useMemo(() => {
    let result = projectsInStore
      .map((project) => {
        const optimisticUpdate = optimisticUpdates[project.id];
        return optimisticUpdate
          ? ({ ...project, ...optimisticUpdate } as ProjectWithStats)
          : project;
      })
      .filter((project) => !statusFilter || project.status === statusFilter);

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.location.toLowerCase().includes(query) ||
          p.customer.name.toLowerCase().includes(query) ||
          p.siteManager?.name.toLowerCase().includes(query),
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let compareResult = 0;

      switch (sortBy) {
        case "name":
          compareResult = a.name.localeCompare(b.name);
          break;
        case "progress":
          compareResult = b.progressPercent - a.progressPercent;
          break;
        case "budget":
          compareResult = Number(b.totalBudget) - Number(a.totalBudget);
          break;
        case "spent":
          compareResult = Number(b.spent) - Number(a.spent);
          break;
        case "startDate":
          compareResult =
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
      }

      return sortOrder === "asc" ? -compareResult : compareResult;
    });

    return result;
  }, [
    projectsInStore,
    optimisticUpdates,
    statusFilter,
    searchQuery,
    sortBy,
    sortOrder,
  ]);

  useEffect(() => {
    dispatch(setProjects(projects));
  }, [projects, dispatch]);

  const handleExport = () => {
    // CSV export logic
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
    const rows = filteredSortedProjects.map((p) => [
      p.name,
      p.customer.name,
      p.location,
      p.siteManager?.name || "—",
      "—", // stage not available in type
      p.totalBudget,
      p.spent,
      `${p.progressPercent}%`,
      p.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const cellStr = String(cell);
            return cellStr.includes(",") ? `"${cellStr}"` : cellStr;
          })
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `projects-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6">
      {/* KPI Cards */}
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

      {/* Main Section */}
      <SectionCard
        title="Active Projects"
        description="Manage all construction projects — click card for quick view, or hit Details for full page"
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
          {/* Filters */}
          <ProjectFilters kpis={kpis} activeFilter={statusFilter} />

          {/* Toolbar */}
          <ProjectToolbar onExport={handleExport} />

          {/* Projects Grid/List */}
          {filteredSortedProjects.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 py-12 px-6 text-center">
              <div className="text-muted-foreground">
                <p className="text-sm font-medium">No projects found</p>
                <p className="text-xs mt-1">
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
          ) : view === "grid" ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {filteredSortedProjects.map((project) => (
                <EnhancedProjectCard
                  key={project.id}
                  project={project}
                  onDetailsClick={(id) => {
                    const proj = filteredSortedProjects.find(
                      (p) => p.id === id,
                    );
                    if (proj) {
                      setSelectedProject(proj);
                      setModalOpen(true);
                    }
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
              rows={filteredSortedProjects.map((project) => [
                <div key={`name-${project.id}`}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium text-teal-600 hover:text-teal-700 hover:underline"
                    onClick={(e) => e.stopPropagation()}
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
                    <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
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
                    className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${(statusConfig[project.status] ?? statusConfig.ACTIVE).bg} ${(statusConfig[project.status] ?? statusConfig.ACTIVE).text}`}
                  >
                    {formatStatus(project.status)}
                  </Badge>
                </div>,
              ])}
              onRowClick={(rowIndex) => {
                const p = filteredSortedProjects[rowIndex];
                if (p) {
                  setSelectedProject(p);
                  setModalOpen(true);
                }
              }}
            />
          )}

          {/* Results Count */}
          {filteredSortedProjects.length > 0 && (
            <div className="text-center text-xs text-muted-foreground pt-2">
              Showing {filteredSortedProjects.length} of {projects.length}{" "}
              projects
            </div>
          )}
        </div>
      </SectionCard>

      {/* Project Detail Modal */}
      <ProjectDetailModal
        project={selectedProject}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
