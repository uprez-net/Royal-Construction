import { StatusPill } from "@/components/common/status-pill";
import { cn } from "@/lib/utils";
import { ProjectDetail, TradieScheduleListItem, TradieScheduleWithTradieAndMilestone, UIMilestone } from "@/types/project";
import { currency, dateFormat, formatStatus } from "@/utils/formatters";
import { ReactNode } from "react";
import Image from "next/image"
import { Button } from "@/components/ui/button";
import {
  Bell,
  Calendar,
  CheckCircle2,
  DollarSign,
  Users,
  Wrench,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MilestoneActionGroup } from "./milestone-action-button"

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

export function MilestoneCard({
  prevMilestone,
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
  prevMilestone?: UIMilestone;
  milestone: UIMilestone;
  project: ProjectDetail;
  depth?: number;
  tradieAlertsByMilestone: Record<
    string,
    TradieScheduleWithTradieAndMilestone[]
  >;
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
            <p
              className={cn(
                "font-bold text-slate-900",
                isCompact ? "text-[13px]" : "text-[14px]",
              )}
            >
              {milestone.name}
            </p>

            <StatusPill tone={tone.pill}>
              {formatStatus(milestone.status)}
            </StatusPill>

            {hasChildren ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                {milestone.childrenMilestones.length} sub
                {milestone.childrenMilestones.length === 1 ? "" : "s"}
              </span>
            ) : null}

            {!isCompact && milestonePictures.length > 0 ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-teal-700">
                {milestonePictures.length} photo
                {milestonePictures.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div
            className={cn(
              "mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5",
              isCompact && "gap-x-3",
            )}
          >
            <MilestoneMetaLine icon={<Calendar className="h-3.5 w-3.5" />}>
              Target: {dateFormat.format(new Date(milestone.targetDate))}
            </MilestoneMetaLine>

            {milestone.actualDate ? (
              <MilestoneMetaLine
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
              >
                Actual: {dateFormat.format(new Date(milestone.actualDate))}
              </MilestoneMetaLine>
            ) : null}

            <MilestoneMetaLine icon={<DollarSign className="h-3.5 w-3.5" />}>
              {currency.format(Number(milestone.budget))} (
              {budgetShare.toFixed(2)}%)
            </MilestoneMetaLine>

            {milestone.tradieSchedules.length > 0 ? (
              <MilestoneMetaLine icon={<Users className="h-3.5 w-3.5" />}>
                {milestone.tradieSchedules
                  .map(
                    (schedule) =>
                      `${schedule.tradie.name} - ${schedule.tradie.trade}`,
                  )
                  .join(", ")}
              </MilestoneMetaLine>
            ) : null}
          </div>
        </div>

        <MilestoneActionGroup
          prevMilestone={prevMilestone}
          milestone={milestone}
          onOpenAddUpdateModal={onOpenAddUpdateModal}
          onStatusUpdate={onStatusUpdate}
          onStartMilestone={onStartMilestone}
          onSendInvoice={onSendInvoice}
        />
      </div>

      {!isCompact && milestonePictures.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {Array.from({ length: Math.min(milestonePictures.length, 4) }).map(
            (_, i) => (
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
            ),
          )}
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
                  Scheduled {dateFormat.format(new Date(t.scheduledDate))}{" "}
                  {!["CONFIRMED", "COMPLETED"].includes(t.status) &&
                    "— Not confirmed!"}
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
                    abn: t.tradie.abn,
                    status: t.status,
                    tradeType: t.tradie.trade,
                    tradieName: t.tradie.name,
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
                    hourlyRate: t.tradie.hourlyRate,
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
                    {milestone.childrenMilestones.length} milestone
                    {milestone.childrenMilestones.length === 1 ? "" : "s"}
                  </span>
                </span>
                <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <ScrollArea className="mt-3 max-h-80 pr-2">
                <div className="space-y-2">
                  {milestone.childrenMilestones.map((child, index) => (
                    <MilestoneCard
                      key={`milestone-${child.id}-${index}`}
                      prevMilestone={prevMilestone}
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