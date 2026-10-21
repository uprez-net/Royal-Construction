"use client";

import Image from "next/image";
import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  DollarSign,
  Users,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  activeOverdueDays,
  daysLate,
  duenessOf,
  isSettled,
  partitionActivities,
} from "@/lib/projects/milestone-ledger";
import { cn } from "@/lib/utils";
import {
  ProjectDetail,
  TradieScheduleListItem,
  TradieScheduleWithTradieAndMilestone,
  UIMilestone,
} from "@/types/project";
import { currency, formatStatus } from "@/utils/formatters";
import { MilestoneStatus } from "@prisma/client";

import { MilestoneActionGroup } from "./milestone-action-button";
import { missingMilestoneTrades } from "@/lib/domain/projects/tradie-dependencies";
import { milestoneEndDate } from "@/lib/domain/projects/milestone-schedule";

/** How many progress photos sit inline before the rest go behind a button. */
const INLINE_PHOTO_LIMIT = 3;

const STATUS_TONE: Record<
  MilestoneStatus,
  "success" | "warning" | "neutral" | "secondary"
> = {
  [MilestoneStatus.DONE]: "success",
  [MilestoneStatus.ACTIVE]: "warning",
  [MilestoneStatus.PENDING]: "neutral",
  [MilestoneStatus.NOT_REQUIRED]: "secondary",
};

/** "27 Aug" — the year is noise on a schedule the user is already inside. */
function shortDate(value: Date) {
  return format(value, "d MMM");
}

function MetaItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

/**
 * The one fact that decides whether a row needs attention today.
 *
 * Overdue is the loudest thing a row can say, so it carries the destructive
 * tone; imminent work carries the warning tone; everything else stays muted.
 */
function DuenessLine({ milestone }: { milestone: UIMilestone }) {
  if (milestone.status === MilestoneStatus.NOT_REQUIRED) {
    return <span>Not required</span>;
  }

  if (milestone.status === MilestoneStatus.DONE) {
    const actual = milestone.actualDate ? new Date(milestone.actualDate) : null;

    if (!actual) {
      return <span>Completed</span>;
    }

    const late = daysLate(milestone, actual);

    return (
      <MetaItem icon={<CheckCircle2 className="size-3.5 text-success-ink" />}>
        Completed{" "}
        <span className="font-mono tabular-nums">{shortDate(actual)}</span>
        {late > 0 ? ` · ${late}d late` : null}
      </MetaItem>
    );
  }

  const endDate = milestoneEndDate(milestone);
  const dueness = duenessOf(milestone, new Date());

  if (dueness.kind === "overdue") {
    return (
      <MetaItem icon={<CircleAlert className="size-3.5" />}>
        <span className="font-semibold text-destructive-ink">
          Overdue {Math.abs(dueness.days)}d
        </span>{" "}
        · was due{" "}
        <span className="font-mono tabular-nums">{shortDate(endDate)}</span>
      </MetaItem>
    );
  }

  if (dueness.kind === "today") {
    return (
      <MetaItem icon={<Calendar className="size-3.5" />}>
        <span className="font-semibold text-warning-ink">Due today</span>
      </MetaItem>
    );
  }

  return (
    <MetaItem icon={<Calendar className="size-3.5" />}>
      <span
        className={cn(
          dueness.kind === "soon" && "font-semibold text-warning-ink",
        )}
      >
        Due <span className="font-mono tabular-nums">{shortDate(endDate)}</span>
        {dueness.kind === "soon" ? ` · in ${dueness.days}d` : null}
      </span>
    </MetaItem>
  );
}

/**
 * One activity in a stage.
 *
 * A flat row, not a card: stages already nest inside the ledger, and wrapping
 * every activity — and then every sub-activity — in its own bordered surface is
 * what drove the old tab to six bordered boxes around a single title. Depth is
 * carried by one hairline rule instead.
 */
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
  const children = milestone.childrenMilestones;
  const hasChildren = children.length > 0;
  const isNotRequired = milestone.status === MilestoneStatus.NOT_REQUIRED;
  const missingTrades = missingMilestoneTrades(
    milestone,
    project.tradieSchedules,
  );
  const runningOverdueDays = activeOverdueDays(milestone, new Date());

  // Finished parents open on request; anything still in flight opens by default,
  // because its children are where the work actually is.
  const [isOpen, setIsOpen] = useState(
    milestone.status !== MilestoneStatus.DONE,
  );

  const photos = milestone.files.filter((file) =>
    file.fileType.startsWith("image/"),
  );
  const photoUrls = photos.map((file) => file.url);
  const nextTradies = tradieAlertsByMilestone[milestone.id] ?? [];
  const settledChildren = children.filter(isSettled).length;
  // Same ordering rule as a stage: what still needs doing sits above what does not.
  const orderedChildren = useMemo(() => {
    const { open, settled } = partitionActivities(children);
    return [...open, ...settled];
  }, [children]);

  return (
    <Collapsible asChild open={isOpen} onOpenChange={setIsOpen}>
      <li
        className={cn(
          "grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]",
          depth === 0 && "border-t border-border/70 first:border-t-0",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <p
              className={cn(
                "font-medium text-foreground",
                depth > 0 ? "text-[13px]" : "text-sm",
                isNotRequired && "text-muted-foreground line-through",
              )}
            >
              {milestone.name}
            </p>

            <StatusPill tone={STATUS_TONE[milestone.status]}>
              {formatStatus(milestone.status)}
            </StatusPill>

            {runningOverdueDays !== null ? (
              <StatusPill tone="danger">
                Overdue
                <span className="sr-only">
                  {" "}
                  — {runningOverdueDays} calendar days past the estimated end
                </span>
              </StatusPill>
            ) : null}

            {hasChildren ? (
              <span className="text-xs text-muted-foreground">
                {settledChildren} of {children.length} item
                {children.length === 1 ? "" : "s"} done
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <DuenessLine milestone={milestone} />

            {isAdmin && Number(milestone.budget) > 0 ? (
              <MetaItem icon={<DollarSign className="size-3.5" />}>
                Budget{" "}
                <span className="font-mono tabular-nums">
                  {currency.format(Number(milestone.budget))}
                </span>
              </MetaItem>
            ) : null}

            {isAdmin && Number(milestone.spend) > 0 ? (
              <MetaItem icon={<DollarSign className="size-3.5" />}>
                Spent{" "}
                <span className="font-mono tabular-nums">
                  {currency.format(Number(milestone.spend))}
                </span>
              </MetaItem>
            ) : null}
          </div>

          {photos.length > 0 ? (
            <ul className="mt-2 flex list-none flex-wrap items-center gap-1.5">
              {photos.slice(0, INLINE_PHOTO_LIMIT).map((photo, index) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    aria-label={`Photo ${index + 1} of ${photos.length} for ${milestone.name}`}
                    className="relative block h-[39px] w-[52px] overflow-hidden rounded-md border border-border/70 bg-muted transition-colors hover:border-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => onOpenViewPicture(photoUrls, index)}
                  >
                    <Image
                      src={photo.url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      width={160}
                      height={120}
                    />
                  </button>
                </li>
              ))}

              {photos.length > INLINE_PHOTO_LIMIT ? (
                <li>
                  <button
                    type="button"
                    aria-label={`View all ${photos.length} photos for ${milestone.name}`}
                    className="inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() =>
                      onOpenViewPicture(photoUrls, INLINE_PHOTO_LIMIT)
                    }
                  >
                    +{photos.length - INLINE_PHOTO_LIMIT} more
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}

          {milestone.tradieSchedules.length > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              <MetaItem icon={<Users className="size-3.5" />}>
                {milestone.tradieSchedules
                  .map(
                    (schedule) =>
                      `${schedule.tradie.name} — ${schedule.tradie.trade}`,
                  )
                  .join(", ")}
              </MetaItem>
            </div>
          ) : null}

          {missingTrades.map((missingTrade) => (
            <p
              key={missingTrade}
              role="status"
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-ink"
            >
              <CircleAlert className="size-3.5" aria-hidden="true" />
              No confirmed {missingTrade} booking for this activity
            </p>
          ))}

          {depth === 0 && nextTradies.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {nextTradies.map((schedule) => (
                <div
                  key={`tradie-alert-${schedule.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
                >
                  <Bell
                    className={cn(
                      "size-3.5 shrink-0",
                      schedule.status === "CONFIRMED"
                        ? "text-muted-foreground"
                        : "text-warning-ink",
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-foreground">
                    <span className="font-medium">
                      Booked: {schedule.tradie.name} ({schedule.tradie.trade})
                    </span>{" "}
                    <span className="text-muted-foreground">
                      ·{" "}
                      <span className="font-mono tabular-nums">
                        {shortDate(new Date(schedule.scheduledDate))}
                      </span>{" "}
                      ·{" "}
                      {schedule.status === "CONFIRMED"
                        ? "confirmed"
                        : "not confirmed"}
                    </span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8"
                    onClick={() =>
                      onSendReminder({
                        id: schedule.id,
                        tradieId: schedule.tradieId,
                        milestoneId: schedule.milestoneId ?? undefined,
                        scheduledDate: new Date(
                          schedule.scheduledDate,
                        ).toISOString(),
                        abn: schedule.tradie.abn,
                        status: schedule.status,
                        tradeType: schedule.tradie.trade,
                        tradieName: schedule.tradie.name,
                        lastQuotedPriceUnit:
                          schedule.tradie.lastQuotedPriceUnit,
                        projectId: schedule.projectId,
                        projectName: project.name,
                        taskLabel: `${milestone.name} - ${schedule.tradie.trade}`,
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
                            project.siteManager?.email ?? "Site Manager Email",
                          phone:
                            project.siteManager?.phone ?? "Site Manager Phone",
                        },
                        lastQuotedPrice: schedule.tradie.lastQuotedPrice,
                        isFavourite: schedule.tradie.isFavourite,
                        note: schedule.tradie.note,
                        requiresQuote: schedule.requiresQuote,
                        quotedPrice: schedule.quotedPrice ?? undefined,
                        refToken: schedule.refToken,
                      } satisfies TradieScheduleListItem)
                    }
                  >
                    <Bell className="mr-1 size-3.5" aria-hidden="true" />
                    Remind {schedule.tradie.name.split(" ")[0]}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group mt-1.5 -ml-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronDown
                  className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                {isOpen ? "Hide" : "Show"} {children.length} item
                {children.length === 1 ? "" : "s"}
                <span className="sr-only">in {milestone.name}</span>
              </button>
            </CollapsibleTrigger>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <MilestoneActionGroup
            isActiveStage={isActiveStage}
            milestone={milestone}
            onOpenAddUpdateModal={onOpenAddUpdateModal}
            onStatusUpdate={onStatusUpdate}
            onStartMilestone={onStartMilestone}
            onMarkasNotRequired={onMarkasNotRequired}
          />
        </div>

        {hasChildren ? (
          <CollapsibleContent className="sm:col-span-2">
            <ul className="ml-1 list-none border-l border-border/70 pl-4">
              {orderedChildren.map((child) => (
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
            </ul>
          </CollapsibleContent>
        ) : null}
      </li>
    </Collapsible>
  );
}
