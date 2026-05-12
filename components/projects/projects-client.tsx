"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { AlertTriangle, CheckCircle2, CircleDot, ClipboardList } from "lucide-react";

import { DataTable } from "@/components/common/data-table";
import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { ProjectCard } from "@/components/project/project-card";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal, setProjectFilter, setProjectView } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs, ProjectWithStats } from "@/lib/data/projects";

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

const statuses = [
  { label: "All", value: null },
  { label: "Active", value: "ACTIVE" },
  { label: "On Track", value: "ON_TRACK" },
  { label: "Needs Attention", value: "NEEDS_ATTENTION" },
  { label: "Delayed", value: "DELAYED" },
] as const;

export function ProjectsClient({ projects, kpis }: { projects: ProjectWithStats[]; kpis: ProjectKPIs }) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const view = useAppSelector((state) => state.ui.projectFilters.view);
  const statusFilter = useAppSelector((state) => state.ui.projectFilters.status);
  const optimisticUpdates = useAppSelector((state) => state.projects.optimisticUpdates);

  const filteredProjects = projects
    .map((project) => {
      const optimisticUpdate = optimisticUpdates[project.id];
      return optimisticUpdate ? ({ ...project, ...optimisticUpdate } as ProjectWithStats) : project;
    })
    .filter((project) => !statusFilter || project.status === statusFilter);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Active" value={String(kpis.totalActive)} note="Projects currently in active delivery" tone="primary" icon={ClipboardList} />
        <MetricCard label="On Track" value={String(kpis.onTrack)} note="Projects tracking to plan" tone="success" icon={CheckCircle2} />
        <MetricCard label="Needs Attention" value={String(kpis.needsAttention)} note="Projects with live issues or blockers" tone="warning" icon={AlertTriangle} />
        <MetricCard label="Delayed" value={String(kpis.delayed)} note="Projects past the current window" tone="danger" icon={CircleDot} />
      </div>

      <SectionCard
        title="Projects"
        description="Live project records are filtered client-side from the cached server payload."
        action={
          <Button type="button" onClick={() => dispatch(openModal({ type: "createProject" }))}>
            New Project
          </Button>
        }
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-full border border-border bg-background p-1">
              <Button type="button" size="sm" variant={view === "grid" ? "default" : "ghost"} onClick={() => dispatch(setProjectView("grid"))}>
                Grid View
              </Button>
              <Button type="button" size="sm" variant={view === "list" ? "default" : "ghost"} onClick={() => dispatch(setProjectView("list"))}>
                List View
              </Button>
            </div>
            <div className="inline-flex flex-wrap gap-2">
              {statuses.map((item) => (
                <Button key={item.label} type="button" size="sm" variant={statusFilter === item.value ? "default" : "outline"} onClick={() => dispatch(setProjectFilter({ status: item.value }))}>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            No projects match the current filter.
          </div>
        ) : view === "grid" ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                id={project.id}
                name={project.name}
                location={project.location}
                status={project.status}
                progressPercent={project.progressPercent}
                spent={Number(project.spent)}
                totalBudget={Number(project.totalBudget)}
                estimatedEndDate={project.estimatedEndDate}
                customerName={project.customer.name}
              />
            ))}
          </div>
        ) : (
          <DataTable
            headers={["Name", "Customer", "Location", "Status", "Progress %", "Budget Used", "End Date"]}
            rows={filteredProjects.map((project) => [
              <Link key={project.id} href={`/project-detail/${project.id}`} className="font-medium text-teal-700 hover:underline">
                {project.name}
              </Link>,
              project.customer.name,
              project.location,
              formatStatus(project.status),
              <span className="font-mono" key={`${project.id}-progress`}>
                {project.progressPercent}%
              </span>,
              <span className="font-mono" key={`${project.id}-budget`}>
                ${Number(project.spent).toLocaleString()} of ${Number(project.totalBudget).toLocaleString()}
              </span>,
              <span className="font-mono" key={`${project.id}-end`}>
                {new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(project.estimatedEndDate)}
              </span>,
            ])}
            onRowClick={(rowIndex) => router.push(`/project-detail/${filteredProjects[rowIndex].id}`)}
          />
        )}
      </SectionCard>
    </div>
  );
}