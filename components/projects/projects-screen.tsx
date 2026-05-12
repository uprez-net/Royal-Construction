import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDot, ClipboardList } from "lucide-react";

import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { ProjectStatus } from "@prisma/client";
import { getProjectKPIs, getProjects } from "@/lib/data/projects";

import { ProjectsViewToggle } from "./projects-view-toggle";

const statuses = [
  { label: "All", value: undefined },
  { label: "Active", value: ProjectStatus.ACTIVE },
  { label: "On Track", value: ProjectStatus.ON_TRACK },
  { label: "Needs Attention", value: ProjectStatus.NEEDS_ATTENTION },
  { label: "Delayed", value: ProjectStatus.DELAYED },
  { label: "Completed", value: ProjectStatus.COMPLETED },
] as const;

function parseStatus(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  return Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : undefined;
}

export async function ProjectsScreen({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const status = parseStatus(searchParams?.status);
  const [projects, kpis] = await Promise.all([
    getProjects(status ? { status } : undefined),
    getProjectKPIs(),
  ]);

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
        description="Live project records are filtered on the server and rendered in either grid or list mode."
      >
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {statuses.map((item) => {
            const active = item.value === status;
            const href = item.value ? `/projects?status=${item.value}` : "/projects";

            return (
              <Button key={item.label} asChild size="sm" variant={active ? "default" : "outline"}>
                <Link href={href}>{item.label}</Link>
              </Button>
            );
          })}
        </div>
        <ProjectsViewToggle projects={projects} />
      </SectionCard>
    </div>
  );
}
