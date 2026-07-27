import {
  Ban,
  CalendarDays,
  Check,
  Hammer,
  LucideIcon,
  Minus,
  Play,
} from "lucide-react";

import { ProjectWithStats } from "@/types/project";
import { dateFormat } from "@/utils/formatters";

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {project.completedMilestoneCount} of {project.milestoneCount}{" "}
          milestones completed
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
        aria-valuetext={`${project.completedMilestoneCount} of ${project.milestoneCount} milestones completed`}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${completionPercent}%` }}
        />
      </div>

      {project.milestones.length > 0 ? (
        <ol className="mt-4">
          {project.milestones.map((m, i) => {
            const isLast = i === project.milestones.length - 1;
            const config = milestoneStatusConfig(m.status);
            const StatusIcon = config.icon;
            const tradies = m.tradies ?? [];
            const extraTradies = tradies.length - 1;

            return (
              <li
                key={m.id}
                className={`flex items-start justify-between gap-4 py-4 ${
                  isLast ? "" : "border-b border-border"
                }`}
              >
                <div className="flex min-w-0 flex-1 gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.dotClass}`}
                  >
                    <StatusIcon aria-hidden="true" className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-medium ${config.titleClass}`}
                      >
                        {m.name}
                      </span>

                      {/* Text label, so status never rides on colour alone. */}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.badgeClass}`}
                      >
                        {config.label}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays aria-hidden="true" className="h-3 w-3" />
                        <span className="font-mono tabular-nums">
                          {dateFormat.format(new Date(m.targetDate))}
                        </span>
                      </span>

                      {tradies.length > 0 ? (
                        <span className="flex items-center gap-1">
                          <Hammer aria-hidden="true" className="h-3 w-3" />
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
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
          No milestones have been set up for this project yet.
        </p>
      )}
    </div>
  );
}
