import { ClipboardList } from "lucide-react";

import { AppShell } from "@/components/common/app-shell";
import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import {
  dashboardMetrics,
  dashboardProjects,
  tickerItems,
} from "@/lib/mock-data";
import { ProjectCard } from "@/components/project/project-card";

export function DashboardHome({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <AppShell
      isSignedIn={isSignedIn}
      activeSlug="dashboard"
      title="Dashboard"
      description="A single composable shell now backs the dashboard, list views, detail pages, and future module screens."
      actions={
        <>
          <div className="rounded-2xl border border-border bg-white px-4 py-2 text-sm font-medium text-slate-700">
            Updated just now
          </div>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <SectionCard
          title="Active projects"
          description="Cards are driven by the same project shape used across detail and list views."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {dashboardProjects.map((project) => (
              <ProjectCard key={project.name} {...project} />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Operational feed"
          description="A reusable pattern for live updates, notifications, and follow-up reminders."
        >
          <div className="space-y-3">
            {tickerItems.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-slate-700"
              >
                <ClipboardList className="mt-0.5 size-4 text-teal-600" />
                <p>{item}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
