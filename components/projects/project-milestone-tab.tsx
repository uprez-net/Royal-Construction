import {
  Ban,
  CalendarDays,
  Check,
  ChevronsDown,
  Hammer,
  ListChecks,
  LucideIcon,
  Minus,
  Play,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ProjectWithStats } from "@/types/project";
import { dateFormat } from "@/utils/formatters";
import { MilestoneStatus, ProjectStage } from "@prisma/client";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

interface MilestoneTabProps {
  project: ProjectWithStats;
}

interface MilestoneStatusConfig {
  label: string;
  icon: LucideIcon;
  /** Solid fill for the timeline dot. */
  dotClass: string;
  /** Tinted `-light` surface + `-ink` text for the status pill. */
  badgeClass: string;
  /** Extra treatment for the milestone name. */
  titleClass: string;
}

const MILESTONE_STATUS_CONFIG: Record<string, MilestoneStatusConfig> = {
  DONE: {
    label: "Done",
    icon: Check,
    dotClass: "bg-success text-primary-foreground",
    badgeClass: "bg-success-light text-success-ink",
    titleClass: "text-foreground",
  },
  ACTIVE: {
    label: "In progress",
    icon: Play,
    dotClass: "bg-primary text-primary-foreground ring-4 ring-primary/15",
    badgeClass: "bg-primary/10 text-primary",
    titleClass: "text-foreground",
  },
  PENDING: {
    label: "Pending",
    icon: Minus,
    dotClass: "border border-border bg-muted text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    titleClass: "text-foreground",
  },
  NOT_REQUIRED: {
    label: "Not required",
    icon: Ban,
    dotClass: "border border-border bg-muted text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    titleClass: "text-muted-foreground line-through",
  },
};

const FALLBACK_MILESTONE_STATUS: MilestoneStatusConfig = {
  label: "Unknown",
  icon: Minus,
  dotClass: "border border-border bg-muted text-muted-foreground",
  badgeClass: "bg-muted text-muted-foreground",
  titleClass: "text-foreground",
};

/** Never throws on an unmapped enum value — an unknown status renders neutral. */
function milestoneStatusConfig(status: string): MilestoneStatusConfig {
  return MILESTONE_STATUS_CONFIG[status] ?? FALLBACK_MILESTONE_STATUS;
}

export function MilestoneTab({ project }: MilestoneTabProps) {
  // Guard the denominator: a project with no milestones would otherwise render
  // an NaN-width bar.
  const completionPercent =
    project.milestoneCount > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (project.completedMilestoneCount / project.milestoneCount) * 100,
            ),
          ),
        )
      : 0;

  const milestonesMappedToStage = project.milestones.reduce<
    Record<ProjectStage, ProjectWithStats["milestones"]>
  >(
    (acc, milestone) => {
      if (!acc[milestone.projectStage]) {
        acc[milestone.projectStage] = [];
      }

      acc[milestone.projectStage].push(milestone);

      return acc;
    },
    {
      [ProjectStage.Deposit]: [],
      [ProjectStage.Slab]: [],
      [ProjectStage.Frame]: [],
      [ProjectStage.Lockup]: [],
      [ProjectStage.Interior_Fit_Out]: [],
      [ProjectStage.Final]: [],
    } as Record<ProjectStage, ProjectWithStats["milestones"]>,
  );

  const stages = Object.entries(milestonesMappedToStage) as [
    ProjectStage,
    ProjectWithStats["milestones"],
  ][];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {project.completedMilestoneCount} of {project.milestoneCount}{" "}
          activities completed
        </p>
        <p className="font-mono text-sm font-medium text-foreground tabular-nums">
          {completionPercent}%
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Milestones completed"
        aria-valuenow={completionPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${project.completedMilestoneCount} of ${project.milestoneCount} activities completed`}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${completionPercent}%` }}
        />
      </div>

      {stages.length > 0 ? (
        <div className="mt-4 space-y-3">
          {stages.map(([stage, milestones]) => {
            const hasActiveMilestone = milestones.some(
              (milestone) => milestone.status === "ACTIVE",
            );
            const isStageComplete = milestones.every(
              (milestone) => milestone.status !== "PENDING",
            );
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
                defaultOpen={hasActiveMilestone}
                className={cn(
                  "rounded-lg border bg-card transition-colors",
                  isStageComplete
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : hasActiveMilestone
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
                    hasActiveMilestone &&
                      !isStageComplete &&
                      "hover:bg-primary/10",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {stage}
                    </h3>
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

                    {hasActiveMilestone && (
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
                    {sortedMilestones.map((milestone) => {
                      const config = milestoneStatusConfig(milestone.status);

                      const StatusIcon = config.icon;
                      const tradies = milestone.tradies ?? [];
                      const extraTradies = tradies.length - 1;

                      return (
                        <div
                          key={milestone.id}
                          className="flex items-start gap-3 rounded-md border border-border/60 bg-background p-3"
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.dotClass}`}
                          >
                            <StatusIcon
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-sm font-medium ${config.titleClass}`}
                              >
                                {milestone.name}
                              </span>

                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.badgeClass}`}
                              >
                                {config.label}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <CalendarDays
                                  aria-hidden="true"
                                  className="h-3 w-3"
                                />

                                <span className="font-mono tabular-nums">
                                  {dateFormat.format(
                                    new Date(milestone.targetDate),
                                  )}
                                </span>
                              </span>

                              {tradies.length > 0 ? (
                                <span className="flex items-center gap-1">
                                  <Hammer
                                    aria-hidden="true"
                                    className="h-3 w-3"
                                  />

                                  <span>
                                    {tradies[0].name}
                                    {extraTradies > 0
                                      ? ` +${extraTradies} more`
                                      : ""}
                                  </span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
          No milestones have been set up for this project yet.
        </p>
      )}
    </div>
  );
}
