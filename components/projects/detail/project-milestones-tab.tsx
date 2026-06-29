import { CalendarCheck2, Bell, Wrench, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import type { ProjectMilestoneMix } from "@/types/ui";
import type {
  MilestoneWithFilesTradiesUpdates,
  ProjectDetail,
  TradieScheduleListItem,
  TradieScheduleWithTradieAndMilestone,
  UIMilestone,
} from "@/types/project";
import { dateFormat } from "@/utils/formatters";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { toast } from "sonner";
import { MilestoneStatus } from "@prisma/client";
import { useMemo } from "react";
import { MilestoneCard } from "./milestone-tab/milestone-card";
import { addWeeks, isWithinInterval } from "date-fns";

const convertToVisualMilestone = (
  milestones: MilestoneWithFilesTradiesUpdates[],
): UIMilestone[] => {
  const milestoneMap: Record<string, UIMilestone> = {};

  // First pass to create all milestones in the map
  milestones.forEach((m) => {
    milestoneMap[m.id] = { ...m, childrenMilestones: [] };
  });

  // Second pass to assign children to their parents
  const rootMilestones: UIMilestone[] = [];
  Object.values(milestoneMap).forEach((milestone) => {
    if (milestone.parentId) {
      const parent = milestoneMap[milestone.parentId];
      if (parent) {
        parent.childrenMilestones.push(milestone);
      }
    } else {
      rootMilestones.push(milestone);
    }
  });

  return rootMilestones;
};

export function ProjectMilestonesTab({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const visualMilestones = useMemo(
    () => convertToVisualMilestone(project.milestones),
    [project.milestones],
  );

  const tradieAlerts = useMemo(() => {
    const now = new Date();
    const nextWeek = addWeeks(now, 1);

    return project.tradieSchedules.filter((schedule) => {
      const hasAlertStatus =
        // schedule.status === "PENDING_RESPONSE" ||
        schedule.status === "CONFIRMED"
        // schedule.status === "NO_RESPONSE" ||
        // schedule.status === "DECLINED";

      const targetDate = schedule.milestone?.targetDate;
      const isMilestoneDueSoon =
        targetDate &&
        isWithinInterval(new Date(targetDate), {
          start: now,
          end: nextWeek,
        });

      return hasAlertStatus || isMilestoneDueSoon;
    });
  }, [project.tradieSchedules]);

  const tradieAlertsByMilestone = useMemo(() => {
    return tradieAlerts.reduce<
      Record<string, TradieScheduleWithTradieAndMilestone[]>
    >((acc, schedule) => {
      if (!schedule.milestoneId || schedule.status !== "CONFIRMED") {
        return acc;
      }

      acc[schedule.milestoneId] = acc[schedule.milestoneId] ?? [];
      acc[schedule.milestoneId].push(schedule);
      return acc;
    }, {});
  }, [tradieAlerts]);

  const milestoneChartData: ProjectMilestoneMix[] = useMemo(() => {
    return project.milestones.reduce((acc, milestone) => {
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
    }, [] as ProjectMilestoneMix[]);
  }, [project.milestones]);

  const handleOpenAddUpdateModal = (id: string) => {
    dispatch(
      openModal({
        type: "addMilestonePicture",
        payload: { milestoneId: id, projectId: project.id },
      }),
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

  const handleAddMilestone = () => {
    dispatch(
      openModal({ type: "addMilestone", payload: { projectId: project.id } }),
    );
  };

  const handleOpenViewPicture = (imageUrl: string) => {
    dispatch(openModal({ type: "viewPicture", payload: { imageUrl } }));
  };

  const handleStatusUpdate = (milestoneId: string) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: { milestoneId, projectId: project.id },
      }),
    );
  };

  const handleStartMilestone = (milestoneId: string) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: MilestoneStatus.ACTIVE,
        },
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
          <div className="flex items-center justify-end gap-2 mt-6">
            <Button size="sm" onClick={() => handleAddMilestone()}>
              <Plus className="mr-1 h-4 w-4" />
              Add Milestone
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {visualMilestones.map((milestone, index) => (
            <MilestoneCard
              key={`milestone-${milestone.id}-${index}-${milestone.status}`}
              prevMilestone={visualMilestones.find((m) => m.order === milestone.order - 1)}
              milestone={milestone}
              project={project}
              tradieAlertsByMilestone={tradieAlertsByMilestone}
              onOpenAddUpdateModal={handleOpenAddUpdateModal}
              onStatusUpdate={handleStatusUpdate}
              onStartMilestone={handleStartMilestone}
              onSendReminder={handleSendReminder}
              onSendInvoice={handleSendInvoice}
              onOpenViewPicture={handleOpenViewPicture}
            />
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border-amber-200/60 bg-linear-to-br from-[#FEF9C3] to-[#FFF3E0] shadow-sm rounded-xl">
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
                      {schedule.tradie.trade} • {schedule.tradie.name}
                      {" - "}
                      {schedule.tradie.abn}
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
                          scheduledDate: new Date(
                            schedule.scheduledDate,
                          ).toISOString(),
                          status: schedule.status,
                          abn: schedule.tradie.abn,
                          tradieName: schedule.tradie.name,
                          tradeType: schedule.tradie.trade,
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
                          isFavourite: schedule.tradie.isFavourite,
                          note: schedule.tradie.note,
                          requiresQuote: schedule.requiresQuote,
                          quotedPrice: schedule.quotedPrice ?? undefined,
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
