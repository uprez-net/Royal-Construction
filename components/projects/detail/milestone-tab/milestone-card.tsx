import { StatusPill } from "@/components/common/status-pill";
import { cn } from "@/lib/utils";
import {
  ProjectDetail,
  TradieScheduleListItem,
  TradieScheduleWithTradieAndMilestone,
  UIMilestone,
} from "@/types/project";
import { currency, dateFormat, formatStatus } from "@/utils/formatters";
import { ReactNode } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Calendar,
  CheckCircle2,
  Users,
  Wrench,
  ChevronDown,
  BanIcon,
  DollarSign,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MilestoneActionGroup } from "./milestone-action-button";
import { MilestoneStatus } from "@prisma/client";

function getMilestoneTone(status: string) {
  if (status === "DONE") {
    return {
      className: "border-border/70 bg-success-light",
      pill: "success" as const,
    };
  }

  if (status === "ACTIVE") {
    return {
      className: "border-border/70 bg-warning-light",
      pill: "warning" as const,
    };
  }

  if (status === "NOT_REQUIRED") {
    return {
      className: "border-border/70 bg-muted",
      pill: "secondary" as const,
    };
  }

  return {
    className: "border-border/70 bg-muted/50",
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
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export function MilestoneCard({
  isAdmin,
  isActiveStage,
  milestone,
  project,
  depth = 0,
  tradieAlertsByMilestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onMarkasNotRequired,
  onStartMilestone,
  onSendReminder,
  onOpenViewPicture,
}: {
  isAdmin: boolean;
  isActiveStage: boolean;
  milestone: UIMilestone;
  project: ProjectDetail;
  depth?: number;
  tradieAlertsByMilestone: Record<
    string,
    TradieScheduleWithTradieAndMilestone[]
  >;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string, status?: MilestoneStatus) => void;
  onStartMilestone: (id: string) => void;
  onMarkasNotRequired: (id: string) => void;
  onSendReminder: (tradieReminder: TradieScheduleListItem) => void;
  onOpenViewPicture: (imageUrls: string[], selectedIndex: number) => void;
}) {
  const tone = getMilestoneTone(milestone.status);
  const hasChildren = milestone.childrenMilestones.length > 0;
  const isCompact = depth > 0;
  const milestonePictures = milestone.files.filter((file) =>
    file.fileType.startsWith("image/"),
  );
  const imageUrls = milestonePictures.map((file) => file.url);
  const nextTradies = tradieAlertsByMilestone[milestone.id] ?? [];
  // const budgetShare = Number(project.totalBudget)
  //   ? (Number(milestone.budget) / Number(project.totalBudget)) * 100
  //   : 0;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[12px] border p-4",
        tone.className,
        isCompact && "p-3",
        depth > 0 && "ml-4",
      )}
    >
      {depth > 0 ? (
        <span
          className="absolute -left-2.5 top-5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
          aria-hidden="true"
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div
          className={cn(
            "min-w-0 flex-1",
            milestone.status === "NOT_REQUIRED" && "opacity-70 line-through",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "font-heading font-semibold text-foreground",
                isCompact ? "text-sm" : "text-base",
              )}
            >
              {milestone.name}
            </p>

            <StatusPill tone={tone.pill}>
              {milestone.status === "NOT_REQUIRED" && (
                <BanIcon className="mr-1 h-4 w-4" aria-hidden="true" />
              )}
              {formatStatus(milestone.status)}
            </StatusPill>

            {hasChildren ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {milestone.childrenMilestones.length} sub-milestone
                {milestone.childrenMilestones.length === 1 ? "" : "s"}
              </span>
            ) : null}

            {milestonePictures.length > 0 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
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
            {!hasChildren && (
              <MilestoneMetaLine icon={<Calendar className="h-3.5 w-3.5" />}>
                Target{" "}
                <span className="font-mono tabular-nums">
                  {dateFormat.format(new Date(milestone.targetDate))}
                </span>
              </MilestoneMetaLine>
            )}

            {milestone.actualDate ? (
              <MilestoneMetaLine
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-success-ink" />}
              >
                Completed{" "}
                <span className="font-mono tabular-nums">
                  {dateFormat.format(new Date(milestone.actualDate))}
                </span>
              </MilestoneMetaLine>
            ) : null}

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

            {isAdmin && (
              <>
                {/* Milestone Budget Data */}
                {parseFloat(milestone.budget) > 0 && (
                  <MilestoneMetaLine
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                  >
                    Budget: {currency.format(parseFloat(milestone.budget))}
                  </MilestoneMetaLine>
                )}
                {/* Milestone Spent Data */}
                {milestone.spend && parseFloat(milestone.spend) > 0 && (
                  <MilestoneMetaLine
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                  >
                    Spent: {currency.format(parseFloat(milestone.spend))}
                  </MilestoneMetaLine>
                )}
              </>
            )}
          </div>
        </div>

        <MilestoneActionGroup
          isActiveStage={isActiveStage}
          milestone={milestone}
          onOpenAddUpdateModal={onOpenAddUpdateModal}
          onStatusUpdate={onStatusUpdate}
          onStartMilestone={onStartMilestone}
          onMarkasNotRequired={onMarkasNotRequired}
        />
      </div>

      {milestonePictures.length > 0 ? (
        <ul className="mt-3 grid list-none grid-cols-2 gap-1.5 sm:grid-cols-4">
          {milestonePictures.slice(0, 3).map((picture, i) => (
            <li key={picture.id}>
              <button
                type="button"
                aria-label={`View progress photo ${i + 1} of ${milestone.name}`}
                className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/50 text-xs text-muted-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={() => onOpenViewPicture(imageUrls, i)}
              >
                <Image
                  src={picture.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  width={800}
                  height={600}
                />
              </button>
            </li>
          ))}
          {milestonePictures.length > 3 ? (
            <li
              className="flex aspect-4/3 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-xs font-medium text-muted-foreground"
              onClick={() => onOpenViewPicture(imageUrls, 3)}
            >
              +{milestonePictures.length - 3} more
            </li>
          ) : null}
        </ul>
      ) : null}

      {!isCompact && nextTradies.length > 0 ? (
        <div className="mt-3 space-y-2">
          {nextTradies.map((t) => (
            <div
              key={`tradie-alert-${t.id}`}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning-light text-warning-ink">
                <Wrench className="h-4 w-4" aria-hidden="true" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  Next up: {t.tradie.name} ({t.tradie.trade})
                </div>

                <div className="text-xs text-muted-foreground">
                  Scheduled{" "}
                  <span className="font-mono tabular-nums">
                    {dateFormat.format(new Date(t.scheduledDate))}
                  </span>
                  {!["CONFIRMED", "COMPLETED"].includes(t.status)
                    ? " — not confirmed"
                    : null}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                aria-label={`Send reminder to ${t.tradie.name}`}
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
                    lastQuotedPriceUnit: t.tradie.lastQuotedPriceUnit,
                    projectId: t.projectId,
                    projectName: project.name,
                    taskLabel: `${milestone.name} - ${t.tradie.trade}`,
                    durationDays: t.durationDays,
                    updatedAt: new Date(t.updatedAt).toISOString(),
                    contact: {
                      email: t.tradie.email,
                      phone: t.tradie.phone,
                      additionalEmails: t.tradie.additionalEmails,
                    },
                    siteManager: {
                      name: project.siteManager?.name ?? "Site Manager",
                      email: project.siteManager?.email ?? "Site Manager Email",
                      phone: project.siteManager?.phone ?? "Site Manager Phone",
                    },
                    lastQuotedPrice: t.tradie.lastQuotedPrice,
                    isFavourite: t.tradie.isFavourite,
                    note: t.tradie.note,
                    requiresQuote: t.requiresQuote,
                    quotedPrice: t.quotedPrice ?? undefined,
                  } satisfies TradieScheduleListItem)
                }
              >
                <Bell className="mr-1 h-4 w-4" aria-hidden="true" />
                Remind
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {hasChildren ? (
        <Collapsible defaultOpen={milestone.childrenMilestones.length <= 3}>
          <div className="mt-4 rounded-[14px] border border-dashed border-border/70 bg-card px-3 py-2.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span>
                  {milestone.childrenMilestones.length} sub-activity
                  {milestone.childrenMilestones.length === 1 ? "" : "s"}
                </span>
                <ChevronDown
                  className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="mt-3 overflow-y-auto no-scrollbar max-h-80 pr-2">
                <div className="space-y-2">
                  {milestone.childrenMilestones.map((child) => (
                    <MilestoneCard
                      key={child.id}
                      isAdmin={isAdmin}
                      isActiveStage={isActiveStage}
                      milestone={child}
                      project={project}
                      depth={depth + 1}
                      tradieAlertsByMilestone={tradieAlertsByMilestone}
                      onOpenAddUpdateModal={onOpenAddUpdateModal}
                      onStatusUpdate={onStatusUpdate}
                      onStartMilestone={onStartMilestone}
                      onSendReminder={onSendReminder}
                      onOpenViewPicture={onOpenViewPicture}
                      onMarkasNotRequired={onMarkasNotRequired}
                    />
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </article>
  );
}
