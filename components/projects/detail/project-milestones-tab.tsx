import {
  CalendarCheck2,
  TriangleAlert,
  Bell,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import type { ProjectMilestoneMix } from "@/types/ui";
import type { ProjectDetail } from "@/types/project";

import { dateFormat, formatStatus } from "@/utils/formatters";

export function ProjectMilestonesTab({ project }: { project: ProjectDetail }) {
  const tradieAlerts = project.tradieSchedules.filter(
    (schedule) =>
      schedule.status === "PENDING_RESPONSE" ||
      schedule.status === "NO_RESPONSE" ||
      schedule.status === "DECLINED",
  );

  const milestoneChartData: ProjectMilestoneMix[] = project.milestones.reduce(
    (acc, milestone) => {
      const statusKey =
        milestone.status === "DONE"
          ? "Completed"
          : milestone.status === "ACTIVE"
            ? "In Progress"
            : "Upcoming";
      const existing = acc.find((item) => item.status === statusKey);

      if (existing) {
        existing.count += 1;
      } else {
        acc.push({
          status: statusKey,
          count: 1,
          color:
            statusKey === "Completed"
              ? "var(--chart-2)"
              : statusKey === "In Progress"
                ? "var(--chart-3)"
                : "var(--muted)",
        });
      }

      return acc;
    },
    [] as ProjectMilestoneMix[],
  );

  return (
    <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-2">
              <CalendarCheck2 className="size-4" />
              Project Milestones
            </CardTitle>
            <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center">
                <span className="mr-1.5 inline-block size-2 rounded-full bg-green-500"></span>
                Done
              </span>
              <span className="flex items-center">
                <span className="mr-1.5 inline-block size-2 rounded-full bg-amber-500"></span>
                Active
              </span>
              <span className="flex items-center">
                <span className="mr-1.5 inline-block size-2 rounded-full bg-slate-300"></span>
                Upcoming
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {project.milestones.map((milestone) => {
            const isDone = milestone.status === "DONE";
            const isActive = milestone.status === "ACTIVE";

            return (
              <article
                key={milestone.id}
                className={`group relative overflow-hidden rounded-[10px] border p-4 transition-all hover:shadow-sm ${
                  isDone
                    ? "border-l-[3px] border-l-green-600 border-border bg-white"
                    : isActive
                      ? "border-l-[3px] border-l-amber-500 border-amber-200/50 bg-amber-50/30"
                      : "border-l-[3px] border-l-border border-border bg-slate-50/50 opacity-80"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[14px] font-bold text-slate-900">
                        {milestone.name}
                      </p>
                      {isActive && (
                        <StatusPill tone="warning">Active</StatusPill>
                      )}
                    </div>
                    <div className="flex gap-4 text-[12.5px] text-muted-foreground mt-1.5">
                      <p>
                        <b>Target:</b> {dateFormat.format(milestone.targetDate)}
                      </p>
                      {milestone.actualDate ? (
                        <p>
                          <b>Actual:</b>{" "}
                          {dateFormat.format(milestone.actualDate)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {isDone && (
                    <StatusPill tone="success">
                      {formatStatus(milestone.status)}
                    </StatusPill>
                  )}
                  {!isDone && !isActive && (
                    <StatusPill tone="neutral">
                      {formatStatus(milestone.status)}
                    </StatusPill>
                  )}
                </div>
              </article>
            );
          })}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border-amber-200/60 bg-gradient-to-br from-[#FEF9C3] to-[#FFF3E0] shadow-sm rounded-xl">
          <CardHeader className="border-b border-amber-200/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.06em] text-[#D97706]">
              <Bell className="size-4" />
              Upcoming Tradie Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {tradieAlerts.length === 0 ? (
              <p className="text-sm text-amber-700">
                All tradie schedules are confirmed.
              </p>
            ) : (
              tradieAlerts.slice(0, 4).map((schedule) => (
                <article
                  key={schedule.id}
                  className="rounded-[10px] border border-amber-200/80 bg-white/60 p-3.5 flex items-center gap-3"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                    <TriangleAlert className="size-5" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-900">
                      {schedule.tradie.trade} •{" "}
                      {schedule.tradie.company ?? schedule.tradie.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Needed by: {schedule.milestone?.name ?? "General"}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-[#D97706]">
                      {formatStatus(schedule.status)}
                    </p>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <DonutChartCard
          title="Milestone Summary"
          subtitle="Progress distribution across phases"
          data={milestoneChartData}
          labelKey="status"
          valueKey="count"
          colorByLabel={{
            Completed: "var(--chart-2)",
            "In Progress": "var(--chart-3)",
            Upcoming: "var(--muted)",
          }}
        />
      </div>
    </section>
  );
}
