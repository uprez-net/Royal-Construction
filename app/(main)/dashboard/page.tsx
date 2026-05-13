import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { ProjectCard } from "@/components/project/project-card";
import {
  dashboardMetrics,
  dashboardProjects,
  tickerItems,
} from "@/lib/mock-data";
import { Clock3 } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <SectionCard
          title="Active projects"
          description="The same card model powers grid, list, and detail screens."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {dashboardProjects.map((project) => (
              <ProjectCard key={project.name} {...project} />
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="Live activity"
          description="Notifications, follow-ups, and operational updates."
        >
          <div className="space-y-3">
            {tickerItems.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/60 p-3"
              >
                <Clock3 className="mt-0.5 size-4 text-teal-600" />
                <p className="text-sm text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
