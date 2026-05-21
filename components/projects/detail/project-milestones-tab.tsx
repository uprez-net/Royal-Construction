import {
  CalendarCheck2,
  TriangleAlert,
  Bell,
  Calendar,
  CheckCircle2,
  DollarSign,
  Users,
  Camera,
  Send,
  Wrench,
  BellRing,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import type { ProjectMilestoneMix } from "@/types/ui";
import type { ProjectDetail, TradieScheduleListItem } from "@/types/project";

import { currency, dateFormat, formatStatus } from "@/utils/formatters";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { toast } from "sonner";

export function ProjectMilestonesTab({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
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

  const handleOpenAddUpdateModal = (id: string) => {
    dispatch(
      openModal({ type: "addUpdate", payload: { project, milestoneId: id } }),
    );
  };

  const handleSendInvoice = () => {
    toast.info("Sending invoice to customer...");
    // dispatch(openModal({ type: "sendInvoice", payload: { project } }));
  };

  const handleSendReminder = (tradieReminder: TradieScheduleListItem) => {
    dispatch(
      openModal({
        type: "tradieReminder",
        payload: { schedule: tradieReminder },
      }),
    );
  };

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
            const milestonePictures = milestone.files.filter((file) =>
              file.fileType.startsWith("image/"),
            );
            const nextTradies = tradieAlerts.filter(
              (alert) => alert.milestoneId === milestone.id,
            );

            const tradieAlert =
              nextTradies.length > 0
                ? nextTradies.map((t) => (
                    <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-amber-200/50 bg-amber-50 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                        <Wrench className="h-4 w-4" />
                      </div>

                      <div className="flex-1">
                        <div className="text-xs font-semibold">
                          Next: {t.tradie.name} ({t.tradie.trade})
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          Scheduled{" "}
                          {dateFormat.format(new Date(t.scheduledDate))}{" "}
                          {!["CONFIRMED", "COMPLETED"].includes(t.status) &&
                            "— Not confirmed!"}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleSendReminder({
                            id: t.id,
                            tradieId: t.tradieId,
                            milestoneId: t.milestoneId ?? undefined,
                            scheduledDate: t.scheduledDate.toISOString(),
                            status: t.status,
                            company: t.tradie.company,
                            tradieName: t.tradie.name,
                            tradeType: t.tradie.tradeType,
                            projectId: t.projectId,
                            projectName: project.name,
                            taskLabel: `${milestone.name} - ${t.tradie.trade}`,
                            durationDays: t.durationDays,
                            updatedAt: new Date(t.updatedAt).toISOString(),
                            contact: {
                              email: t.tradie.email,
                              phone: t.tradie.phone,
                            },
                            siteManager: {
                              name: project.siteManager?.name ?? "Site Manager",
                              email:
                                project.siteManager?.email ??
                                "Site Manager Email",
                              phone:
                                project.siteManager?.phone ??
                                "Site Manager Phone",
                            },
                          } satisfies TradieScheduleListItem)
                        }
                      >
                        <Bell className="mr-1 h-4 w-4" />
                        Remind
                      </Button>
                    </div>
                  ))
                : null;

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
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground mt-1.5">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          Target:{" "}
                          {dateFormat.format(new Date(milestone.targetDate))}
                        </span>
                      </div>

                      {milestone.actualDate && (
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          <span>
                            Actual:{" "}
                            {dateFormat.format(new Date(milestone.actualDate))}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        <span>
                          {currency.format(Number(milestone.budget))}{" "}
                          {`(${(
                            (Number(milestone.budget) /
                              Number(project.totalBudget)) *
                            100
                          ).toFixed(2)}
                          %)`}
                        </span>
                      </div>

                      {milestone.tradieSchedules.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          <span>
                            {" "}
                            {milestone.tradieSchedules
                              .map(
                                (s) => `${s.tradie.name} - ${s.tradie.trade}`,
                              )
                              .join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {milestone.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        onClick={() => handleOpenAddUpdateModal(milestone.id)}
                      >
                        <Camera className="mr-1 h-4 w-4" />
                        Add Photo
                      </Button>
                    )}

                    {milestone.status === "DONE" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSendInvoice}
                      >
                        <Send className="mr-1 h-4 w-4" />
                        Invoice
                      </Button>
                    )}
                  </div>
                </div>

                {milestonePictures.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {Array.from({
                      length: Math.min(milestonePictures.length, 4),
                    }).map((_, i) => (
                      <div
                        key={i}
                        className="group relative flex aspect-4/3 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/50 text-xs text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600"
                      >
                        <Image
                          src={milestonePictures[i].url}
                          alt={`Photo ${i + 1}`}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                          width={800}
                          height={600}
                        />
                      </div>
                    ))}
                    {milestonePictures.length > 4 && (
                      <div className="flex aspect-4/3 cursor-pointer items-center justify-center rounded-md border border-border/50 bg-muted/50 text-xs font-medium text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600">
                        +{milestonePictures.length - 4}
                      </div>
                    )}
                  </div>
                )}
                {tradieAlert}
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
                    <Wrench className="size-5" />
                  </div>
                  
                  <div>
                    <p className="text-[13px] font-bold text-slate-900">
                      {schedule.tradie.trade} •{" "}
                      {schedule.tradie.company ?? schedule.tradie.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Needed for: {schedule.milestone?.name ?? "General"} —{" "}
                      {dateFormat.format(new Date(schedule.scheduledDate))}
                    </p>
                  </div>

                  <div className="ml-auto">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() =>
                        handleSendReminder({
                          id: schedule.id,
                          tradieId: schedule.tradieId,
                          milestoneId: schedule.milestoneId ?? undefined,
                          scheduledDate: schedule.scheduledDate.toISOString(),
                          status: schedule.status,
                          company: schedule.tradie.company,
                          tradieName: schedule.tradie.name,
                          tradeType: schedule.tradie.tradeType,
                          projectId: schedule.projectId,
                          projectName: project.name,
                          taskLabel: `${project.milestones.find((m) => m.id === schedule.milestoneId)?.name ?? "General"} - ${schedule.tradie.trade}`,
                          durationDays: schedule.durationDays,
                          updatedAt: new Date(schedule.updatedAt).toISOString(),
                          contact: {
                            email: schedule.tradie.email,
                            phone: schedule.tradie.phone,
                          },
                          siteManager: {
                            name: project.siteManager?.name ?? "Site Manager",
                            email:
                              project.siteManager?.email ??
                              "Site Manager Email",
                            phone:
                              project.siteManager?.phone ??
                              "Site Manager Phone",
                          },
                        } satisfies TradieScheduleListItem)
                      }
                    >
                      <Bell className="size-3.5" />
                    </Button>
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
