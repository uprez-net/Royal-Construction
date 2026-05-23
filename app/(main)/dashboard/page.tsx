"use client"
import { MetricCard } from "@/components/common/metric-card"
import { SectionCard } from "@/components/common/section-card"
import { Badge } from "@/components/ui/badge"
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

const statusToneMap: Record<string, string> = {
  "On Track": "bg-emerald-100 text-emerald-700",
  ACTIVE: "bg-teal-100 text-teal-700",
  ON_TRACK: "bg-emerald-100 text-emerald-700",
  NEEDS_ATTENTION: "bg-amber-100 text-amber-700",
  Delayed: "bg-red-100 text-red-700",
  DELAYED: "bg-red-100 text-red-700",
  COMPLETED: "bg-slate-100 text-slate-700",
  "Pending Quote": "bg-amber-100 text-amber-700",
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ")
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
          <div className="divide-y divide-border/60">
            {dashboardProjects.map((project) => {
              const statusTone = statusToneMap[project.status] ?? "bg-slate-100 text-slate-700"
              return (
                <div key={project.name} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="text-sm font-medium leading-none text-foreground">{project.name}</span>
                      <Badge className={cn("border-0 rounded-full px-2.5 py-0.5 text-xs font-medium", statusTone)}>
                        {formatStatus(project.status)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{project.client} · {project.stage}</p>
                  </div>
                  <div className="w-32 shrink-0 space-y-1.5">
                    <div className="flex justify-end">
                      <span className="font-mono text-xs font-medium text-muted-foreground">{project.progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-teal-600" style={{ width: `${project.progress}%` }} />
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right font-mono text-sm font-medium text-foreground">
                    {project.budget}
                  </div>
                </div>
              )
            })}
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
