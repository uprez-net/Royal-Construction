"use client"
import { MetricCard } from "@/components/common/metric-card"
import { SectionCard } from "@/components/common/section-card"
import { ProjectCard } from "@/components/project/project-card"
import {
  activityItems,
  dashboardMetrics,
  dashboardProjects,
} from "@/lib/mock-data"
import { AlertTriangle, Calendar, CheckCircle2, CircleDot } from "lucide-react"
import { cn } from "@/lib/utils"

const activityIconMap = {
  progress: { icon: CheckCircle2, className: "text-emerald-600" },
  warning: { icon: AlertTriangle, className: "text-amber-500" },
  upcoming: { icon: Calendar, className: "text-teal-600" },
  info: { icon: CircleDot, className: "text-slate-400" },
}

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
          description="Current builds across all sites."
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
          <div className="divide-y divide-border/60">
            {activityItems.map((item) => {
              const { icon: Icon, className } = activityIconMap[item.type]
              return (
                <div key={item.text} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon className={cn("mt-0.5 size-4 flex-shrink-0", className)} />
                  <p className="text-sm leading-snug text-muted-foreground">{item.text}</p>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
