import {
  CalendarCheck2,
  Bell,
  Wrench,
  Plus,
  DollarSign,
  ListChecks,
  ChevronsDown,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import type { ProjectMilestoneMix } from "@/types/ui";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_PERCENTAGE,
  type MilestoneWithFilesTradiesUpdates,
  type ProjectDetail,
  type TradieScheduleListItem,
  type TradieScheduleWithTradieAndMilestone,
  type UIMilestone,
} from "@/types/project";
import { currency, dateFormat } from "@/utils/formatters";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { MilestoneStatus, ProjectStage } from "@prisma/client";
import { useMemo } from "react";
import { MilestoneCard } from "./milestone-tab/milestone-card";
import { addWeeks, isWithinInterval } from "date-fns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const convertToVisualMilestone = (
  milestones: MilestoneWithFilesTradiesUpdates[],
): UIMilestone[] => {
  const milestoneMap: Record<string, UIMilestone> = {};

  // First pass: create every milestone so parents can be referenced
  // regardless of their position in the input array.
  milestones.forEach((m) => {
    milestoneMap[m.id] = {
      ...m,
      childrenMilestones: [],
    };
  });

  const rootMilestones: UIMilestone[] = [];

  // Second pass: build the hierarchy.
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

  // Sort children recursively and roots by order.
  const sortMilestones = (items: UIMilestone[]) => {
    items.sort((a, b) => a.order - b.order);

    items.forEach((milestone) => {
      sortMilestones(milestone.childrenMilestones);
    });
  };

  sortMilestones(rootMilestones);

  return rootMilestones;
};

const calcMilestoneOverviewData = (milestones: ProjectDetail["milestones"]) => {
  const stageMilestoneMap = new Map<
    string,
    { completed: number; total: number }
  >();
  for (const milestone of milestones) {
    const stage = milestone.projectStage;
    if (!stageMilestoneMap.has(stage)) {
      stageMilestoneMap.set(stage, { completed: 0, total: 0 });
    }
    const stageData = stageMilestoneMap.get(stage)!;
    stageData.total++;
    if (milestone.status === "DONE" || milestone.status === "NOT_REQUIRED") {
      stageData.completed++;
    }
  }
  const totalStages = stageMilestoneMap.size;
  const completedStages = Array.from(stageMilestoneMap.values()).filter(
    (stageData) => stageData.completed === stageData.total,
  ).length;
  const inProgressStages = Array.from(stageMilestoneMap.values()).filter(
    (stageData) =>
      stageData.completed > 0 && stageData.completed < stageData.total,
  ).length;
  return {
    totalStages,
    completedStages,
    inProgressStages: inProgressStages > 0 ? inProgressStages : completedStages < totalStages ? 1 : 0,
  };
};

export function ProjectMilestonesTab({
  project,
  isAdmin,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
}) {
  const dispatch = useAppDispatch();
  const visualMilestones = useMemo(
    () => convertToVisualMilestone(project.milestones),
    [project.milestones],
  );
  const visualMilestonesGroupedByProjectStage = useMemo(() => {
    return visualMilestones.reduce<Record<ProjectStage, UIMilestone[]>>(
      (acc, milestone) => {
        const stage = milestone.projectStage;
        acc[stage] = acc[stage] ?? [];
        acc[stage].push(milestone);
        return acc;
      },
      {} as Record<ProjectStage, UIMilestone[]>,
    );
  }, [visualMilestones]);

  const tradieAlerts = useMemo(() => {
    const now = new Date();
    const nextWeek = addWeeks(now, 1);

    return project.tradieSchedules.filter((schedule) => {
      const hasAlertStatus = schedule.status === "CONFIRMED";

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
    const {
      totalStages: projectStagesCount,
      completedStages: completedStagesCount,
      inProgressStages: inProgressStagesCount,
    } = calcMilestoneOverviewData(project.milestones);
    const graphData: ProjectMilestoneMix[] = [
      {
        status: "Completed",
        count: completedStagesCount,
        color: "var(--chart-2)",
      },
      {
        status: "In Progress",
        count: inProgressStagesCount,
        color: "var(--chart-3)",
      },
      {
        status: "Upcoming",
        count:
          projectStagesCount - completedStagesCount - inProgressStagesCount,
        color: "var(--chart-5)",
      }
    ];
    return graphData;
  }, [project.milestones]);

  const handleOpenAddUpdateModal = (id: string) => {
    dispatch(
      openModal({
        type: "addMilestonePicture",
        payload: { milestoneId: id, projectId: project.id },
      }),
    );
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

  const handleOpenViewPicture = (
    imageUrls: string[],
    selectedIndex: number,
  ) => {
    dispatch(
      openModal({ type: "viewPicture", payload: { imageUrls, selectedIndex } }),
    );
  };

  const handleStatusUpdate = (milestoneId: string, status?: MilestoneStatus) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: status || MilestoneStatus.DONE,
          isAdmin: isAdmin,
        },
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

  const handleMarkAsNotRequired = (milestoneId: string) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: MilestoneStatus.NOT_REQUIRED,
        },
      }),
    );
  };

  // Grouping by stage yields whatever order the milestones happened to arrive
  // in (they are sorted by `order`, which need not follow the contract stages),
  // so the accordion is driven by the canonical stage sequence instead.
  const stageGroups = (Object.keys(PROJECT_STAGE_PERCENTAGE) as ProjectStage[])
    .filter((stage) => visualMilestonesGroupedByProjectStage[stage]?.length)
    .map(
      (stage) => [stage, visualMilestonesGroupedByProjectStage[stage]] as const,
    );

  return (
    <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle
              as="h2"
              className="flex items-center gap-2 text-base font-semibold text-foreground"
            >
              <CalendarCheck2
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Project milestones
            </CardTitle>
            <ul className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <li className="flex items-center">
                <span
                  className="mr-1.5 inline-block size-2 rounded-full bg-success"
                  aria-hidden="true"
                />
                Done
              </li>
              <li className="flex items-center">
                <span
                  className="mr-1.5 inline-block size-2 rounded-full bg-warning"
                  aria-hidden="true"
                />
                Active
              </li>
              <li className="flex items-center">
                <span
                  className="mr-1.5 inline-block size-2 rounded-full bg-chart-5"
                  aria-hidden="true"
                />
                Upcoming
              </li>
            </ul>
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button size="sm" onClick={handleAddMilestone}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Add Activity
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {stageGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground">
                No activities yet
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add the first activity to break this project into stages with
                target dates and budgets.
              </p>
            </div>
          ) : (
            stageGroups.map(([stage, milestones]) => {
              const isStageComplete = milestones
                .flatMap((m) => [m, ...m.childrenMilestones])
                .every((m) => m.status !== "PENDING");
              const firstActiveStage = stageGroups.find(([, milestones]) => {
                return milestones
                  .flatMap((m) => [m, ...m.childrenMilestones])
                  .some((m) => m.status === "PENDING");
              })?.[0];

              const isActiveStage = stage === firstActiveStage;
              const stagePercentage = PROJECT_STAGE_PERCENTAGE[stage] ?? 0;
              const projectBudget = Number(project.totalBudget);
              const stageBudget = Number.isFinite(projectBudget)
                ? stagePercentage * projectBudget
                : null;

              // Sort milestone by status Completed > Active > Pending
              const sortedMilestones = [...milestones].sort((a, b) => {
                const statusOrder: Record<MilestoneStatus, number> = {
                  DONE: 0,
                  ACTIVE: 1,
                  PENDING: 2,
                  NOT_REQUIRED: 3,
                };
                return statusOrder[a.status] - statusOrder[b.status];
              });

              return (
                <Collapsible
                  key={stage}
                  defaultOpen={isActiveStage}
                  className={cn(
                    "rounded-lg border bg-card transition-colors",
                    isStageComplete
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : isActiveStage
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/70",
                  )}
                >
                  <CollapsibleTrigger
                    className={cn(
                      "group flex w-full items-center justify-between px-4 py-3",
                      "transition-colors hover:bg-muted/40",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      isStageComplete && "hover:bg-emerald-500/10",
                      isActiveStage &&
                        !isStageComplete &&
                        "hover:bg-primary/10",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <h3
                        className={cn(
                          "text-sm font-semibold",
                          isStageComplete
                            ? "text-emerald-700 dark:text-emerald-400"
                            : isActiveStage
                              ? "text-primary"
                              : "text-foreground",
                        )}
                      >
                        {PROJECT_STAGE_LABELS[stage] ?? stage}
                      </h3>

                      {isAdmin && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <DollarSign className="size-3.5" aria-hidden="true" />
                          <span className="font-mono tabular-nums">
                            {stageBudget === null
                              ? "—"
                              : currency.format(stageBudget)}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isStageComplete && (
                        <Badge
                          variant="default"
                          className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium hover:bg-emerald-600"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          Complete
                        </Badge>
                      )}

                      {isActiveStage && (
                        <Badge
                          variant="secondary"
                          className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        >
                          <ListChecks className="size-3.5" aria-hidden="true" />
                          Active
                        </Badge>
                      )}
                      <Badge
                        variant="secondary"
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                      >
                        <ListChecks className="size-3.5" aria-hidden="true" />
                        {milestones.length} activit
                        {milestones.length === 1 ? "y" : "ies"}
                      </Badge>

                      <ChevronsDown
                        className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="space-y-2 border-t border-border/70 p-3">
                      {sortedMilestones.map((milestone) => (
                        <MilestoneCard
                          key={milestone.id}
                          isActiveStage={isActiveStage}
                          isAdmin={isAdmin}
                          milestone={milestone}
                          project={project}
                          tradieAlertsByMilestone={tradieAlertsByMilestone}
                          onOpenAddUpdateModal={handleOpenAddUpdateModal}
                          onStatusUpdate={handleStatusUpdate}
                          onStartMilestone={handleStartMilestone}
                          onSendReminder={handleSendReminder}
                          onOpenViewPicture={handleOpenViewPicture}
                          onMarkasNotRequired={handleMarkAsNotRequired}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-xl border-border/70 bg-card shadow-sm">
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle
              as="h2"
              className="flex items-center gap-2 text-base font-semibold text-foreground"
            >
              <Bell className="size-4 text-warning-ink" aria-hidden="true" />
              Upcoming tradie alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {tradieAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {project.tradieSchedules.length === 0
                  ? "No tradies are scheduled on this project yet."
                  : "No tradie schedules need attention in the next week."}
              </p>
            ) : (
              tradieAlerts.slice(0, 4).map((schedule) => (
                <article
                  key={schedule.id}
                  className="flex items-center gap-3 rounded-[10px] border border-border/70 bg-card p-3.5"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-warning-light text-warning-ink">
                    <Wrench className="size-5" aria-hidden="true" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {schedule.tradie.trade} • {schedule.tradie.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      ABN{" "}
                      <span className="font-mono tabular-nums">
                        {schedule.tradie.abn}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Needed for {schedule.milestone?.name ?? "general works"}{" "}
                      on{" "}
                      <span className="font-mono tabular-nums">
                        {dateFormat.format(new Date(schedule.scheduledDate))}
                      </span>
                    </p>
                  </div>

                  <div className="ml-auto">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9"
                      aria-label={`Send reminder to ${schedule.tradie.name}`}
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
                          lastQuotedPriceUnit:
                            schedule.tradie.lastQuotedPriceUnit,
                          tradeType: schedule.tradie.trade,
                          projectId: schedule.projectId,
                          projectName: project.name,
                          taskLabel: `${project.milestones.find((m) => m.id === schedule.milestoneId)?.name ?? "General"} - ${schedule.tradie.trade}`,
                          durationDays: schedule.durationDays,
                          updatedAt: new Date(schedule.updatedAt).toISOString(),
                          contact: {
                            email: schedule.tradie.email,
                            phone: schedule.tradie.phone,
                            additionalEmails: schedule.tradie.additionalEmails,
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
                      <Bell className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <DonutChartCard
          title="Milestone summary"
          subtitle="Progress distribution across phases"
          data={milestoneChartData}
          labelKey="status"
          valueKey="count"
          colorByLabel={{
            Completed: "var(--chart-2)",
            "In Progress": "var(--chart-3)",
            Upcoming: "var(--chart-5)",
          }}
        />
      </div>
    </section>
  );
}
