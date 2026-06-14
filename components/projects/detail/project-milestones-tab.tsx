import {
  CalendarCheck2,
  Bell,
  Calendar,
  CheckCircle2,
  DollarSign,
  Users,
  Camera,
  Send,
  Wrench,
  Plus,
  FilePenLine,
  Play,
  ChevronDown,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import type { ProjectMilestoneMix } from "@/types/ui";
import type {
  MilestoneWithFilesTradiesUpdates,
  ProjectDetail,
  TradieScheduleListItem,
  TradieScheduleWithTradieAndMilestone,
  UIMilestone,
} from "@/types/project";

import { currency, dateFormat, formatStatus } from "@/utils/formatters";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { toast } from "sonner";
import { MilestoneStatus } from "@prisma/client";
import { useMemo, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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

function getMilestoneTone(status: string) {
  if (status === "DONE") {
    return {
      className: "border-green-200/70 bg-green-50/60",
      pill: "success" as const,
    };
  }

  if (status === "ACTIVE") {
    return {
      className: "border-amber-200/70 bg-amber-50/50",
      pill: "warning" as const,
    };
  }

  return {
    className: "border-border/70 bg-slate-50/70",
    pill: "neutral" as const,
  };
}

function MilestoneMetaLine({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

function MilestoneActionGroup({
  milestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onStartMilestone,
  onSendInvoice,
}: {
  milestone: UIMilestone;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string) => void;
  onStartMilestone: (id: string) => void;
  onSendInvoice: () => void;
}) {
  if (milestone.status === "PENDING" && milestone.childrenMilestones.length === 0) {
    return (
      <Button size="sm" onClick={() => onStartMilestone(milestone.id)}>
        <Play className="mr-1 h-4 w-4" />
        Start Milestone
      </Button>
    );
  }

  if (milestone.status === "ACTIVE") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => onOpenAddUpdateModal(milestone.id)}>
          <Camera className="mr-1 h-4 w-4" />
          Add Photo
        </Button>

        <Button size="sm" onClick={() => onStatusUpdate(milestone.id)}>
          <FilePenLine className="mr-1 h-4 w-4" />
          Update Status
        </Button>
      </div>
    );
  }

  if (milestone.status === "DONE") {
    return (
      <Button variant="outline" size="sm" onClick={onSendInvoice}>
        <Send className="mr-1 h-4 w-4" />
        Invoice
      </Button>
    );
  }

  return null;
}

function MilestoneCard({
  milestone,
  project,
  depth = 0,
  tradieAlertsByMilestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onStartMilestone,
  onSendReminder,
  onSendInvoice,
  onOpenViewPicture,
}: {
  milestone: UIMilestone;
  project: ProjectDetail;
  depth?: number;
  tradieAlertsByMilestone: Record<string, TradieScheduleWithTradieAndMilestone[]>;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string) => void;
  onStartMilestone: (id: string) => void;
  onSendReminder: (tradieReminder: TradieScheduleListItem) => void;
  onSendInvoice: () => void;
  onOpenViewPicture: (imageUrl: string) => void;
}) {
  const tone = getMilestoneTone(milestone.status);
  const hasChildren = milestone.childrenMilestones.length > 0;
  const isCompact = depth > 0;
  const milestonePictures = !isCompact
    ? milestone.files.filter((file) => file.fileType.startsWith("image/"))
    : [];
  const nextTradies = tradieAlertsByMilestone[milestone.id] ?? [];
  const budgetShare = Number(project.totalBudget)
    ? (Number(milestone.budget) / Number(project.totalBudget)) * 100
    : 0;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[12px] border p-4 transition-all hover:shadow-sm",
        tone.className,
        isCompact && "p-3",
        depth > 0 && "ml-4 border-l-[3px]",
      )}
    >
      {depth > 0 ? (
        <span className="absolute -left-2.5 top-5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("font-bold text-slate-900", isCompact ? "text-[13px]" : "text-[14px]")}>{milestone.name}</p>

            <StatusPill tone={tone.pill}>{formatStatus(milestone.status)}</StatusPill>

            {hasChildren ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                {milestone.childrenMilestones.length} sub{milestone.childrenMilestones.length === 1 ? "" : "s"}
              </span>
            ) : null}

            {!isCompact && milestonePictures.length > 0 ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-teal-700">
                {milestonePictures.length} photo{milestonePictures.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className={cn("mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5", isCompact && "gap-x-3")}>
            <MilestoneMetaLine icon={<Calendar className="h-3.5 w-3.5" />}>
              Target: {dateFormat.format(new Date(milestone.targetDate))}
            </MilestoneMetaLine>

            {milestone.actualDate ? (
              <MilestoneMetaLine icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}>
                Actual: {dateFormat.format(new Date(milestone.actualDate))}
              </MilestoneMetaLine>
            ) : null}

            <MilestoneMetaLine icon={<DollarSign className="h-3.5 w-3.5" />}>
              {currency.format(Number(milestone.budget))} ({budgetShare.toFixed(2)}%)
            </MilestoneMetaLine>

            {milestone.tradieSchedules.length > 0 ? (
              <MilestoneMetaLine icon={<Users className="h-3.5 w-3.5" />}>
                {milestone.tradieSchedules
                  .map((schedule) => `${schedule.tradie.name} - ${schedule.tradie.trade}`)
                  .join(", ")}
              </MilestoneMetaLine>
            ) : null}
          </div>
        </div>

        <MilestoneActionGroup
          milestone={milestone}
          onOpenAddUpdateModal={onOpenAddUpdateModal}
          onStatusUpdate={onStatusUpdate}
          onStartMilestone={onStartMilestone}
          onSendInvoice={onSendInvoice}
        />
      </div>

      {!isCompact && milestonePictures.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {Array.from({ length: Math.min(milestonePictures.length, 4) }).map((_, i) => (
            <div
              key={i}
              className="group relative flex aspect-4/3 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/50 text-xs text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600"
              onClick={() => onOpenViewPicture(milestonePictures[i].url)}
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
          {milestonePictures.length > 4 ? (
            <div className="flex aspect-4/3 cursor-pointer items-center justify-center rounded-md border border-border/50 bg-muted/50 text-xs font-medium text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600">
              +{milestonePictures.length - 4}
            </div>
          ) : null}
        </div>
      ) : null}

      {!isCompact && nextTradies.length > 0 ? (
        <div className="mt-3 space-y-2">
          {nextTradies.map((t) => (
            <div
              key={`tradie-alert-${t.id}`}
              className="flex items-center gap-3 rounded-xl border border-amber-200/50 bg-amber-50 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <Wrench className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">
                  Next: {t.tradie.name} ({t.tradie.trade})
                </div>

                <div className="text-[11px] text-muted-foreground">
                  Scheduled {dateFormat.format(new Date(t.scheduledDate))} {!['CONFIRMED', 'COMPLETED'].includes(t.status) && "— Not confirmed!"}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onSendReminder({
                    id: t.id,
                    tradieId: t.tradieId,
                    milestoneId: t.milestoneId ?? undefined,
                    scheduledDate: new Date(t.scheduledDate).toISOString(),
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
                      email: project.siteManager?.email ?? "Site Manager Email",
                      phone: project.siteManager?.phone ?? "Site Manager Phone",
                    },
                  } satisfies TradieScheduleListItem)
                }
              >
                <Bell className="mr-1 h-4 w-4" />
                Remind
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {hasChildren ? (
        <Collapsible defaultOpen={milestone.childrenMilestones.length <= 3}>
          <div className="mt-4 rounded-[14px] border border-dashed border-border/70 bg-white/60 px-3 py-2.5">
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center justify-between gap-3 text-left text-[12px] font-semibold text-slate-700 transition-colors hover:text-teal-700">
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600">
                    Children
                  </span>
                  <span>
                    {milestone.childrenMilestones.length} milestone{milestone.childrenMilestones.length === 1 ? "" : "s"}
                  </span>
                </span>
                <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <ScrollArea className="mt-3 max-h-80 pr-2">
                <div className="space-y-2">
                  {milestone.childrenMilestones.map((child) => (
                    <MilestoneCard
                      key={child.id}
                      milestone={child}
                      project={project}
                      depth={depth + 1}
                      tradieAlertsByMilestone={tradieAlertsByMilestone}
                      onOpenAddUpdateModal={onOpenAddUpdateModal}
                      onStatusUpdate={onStatusUpdate}
                      onStartMilestone={onStartMilestone}
                      onSendReminder={onSendReminder}
                      onSendInvoice={onSendInvoice}
                      onOpenViewPicture={onOpenViewPicture}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </article>
  );
}

export function ProjectMilestonesTab({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const visualMilestones = useMemo(
    () => convertToVisualMilestone(project.milestones),
    [project.milestones],
  );
  const tradieAlerts = useMemo(
    () =>
      project.tradieSchedules.filter(
        (schedule) =>
          schedule.status === "PENDING_RESPONSE" ||
          schedule.status === "NO_RESPONSE" ||
          schedule.status === "DECLINED",
      ),
    [project.tradieSchedules],
  );

  const tradieAlertsByMilestone = useMemo(() => {
    return tradieAlerts.reduce<Record<string, TradieScheduleWithTradieAndMilestone[]>>(
      (acc, schedule) => {
        if (!schedule.milestoneId) {
          return acc;
        }

        acc[schedule.milestoneId] = acc[schedule.milestoneId] ?? [];
        acc[schedule.milestoneId].push(schedule);
        return acc;
      },
      {},
    );
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
      openModal({ type: "addMilestonePicture", payload: { milestoneId: id, projectId: project.id } }),
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
        payload: { milestoneId, projectId: project.id, newStatus: MilestoneStatus.ACTIVE },
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
          {visualMilestones.map((milestone) => (
            <MilestoneCard
              key={milestone.id}
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
                          scheduledDate: new Date(schedule.scheduledDate).toISOString(),
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
