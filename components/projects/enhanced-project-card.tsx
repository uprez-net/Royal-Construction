"use client";

import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import type { ProjectWithStats } from "@/types/project";
import { Badge } from "@/components/ui/badge";
import { compactCurrency } from "@/utils/formatters";
import { calcStageProgress } from "@/lib/projects/stage-progress";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
import { ProjectAttentionReasons } from "./project-attention-reasons";
import { formatStatus, projectStatusConfig } from "./project-status";
import type { Role as UserRoles } from "@prisma/client";

interface EnhancedProjectCardProps {
  role: UserRoles;
  project: ProjectWithStats;
  onDetailsClick?: (projectId: string) => void;
  /** The full project page, carrying the list it was opened from. */
  detailsHref: string;
}

export function EnhancedProjectCard({
  role,
  project,
  onDetailsClick,
  detailsHref,
}: EnhancedProjectCardProps) {
  const isAdmin = role === "ADMIN";
  const config = projectStatusConfig(project.status);
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  // A project can legitimately have no budget set yet; the `hasBudget` guard
  // keeps the "—" display for the budget stat when no contract value is set.
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const isOverBudget = getBudgetStatus(budget, spent) === "OVER_BUDGET";
  const progress = Math.round(project.progressPercent);
  const progressLabelId = `project-progress-${project.id}`;
  const { totalStages, completedStages } = calcStageProgress(
    project.milestones,
  );
  // Money in. Every other figure on this row is money out or committed, so the
  // card said nothing about what the owner has actually paid.
  const cleared = Number(project.invoiceTotals.paid);

  const openQuickView = () => onDetailsClick?.(project.id);

  return (
    <div className="group overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4 transition-colors hover:bg-muted/40">
      {/* The card body is a mouse convenience only: the project-name button
          below performs the same action, so keyboard users have full parity
          without turning the whole card (which contains its own links) into a
          control. */}
      <div className="p-5" onClick={openQuickView}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug text-foreground">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openQuickView();
                }}
                className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {project.name}
                <span className="sr-only"> — open quick view</span>
              </button>
            </h3>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              {project.location}
            </p>
          </div>
          <Badge
            className={`h-[22px] shrink-0 gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ${config.badge}`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current"
            />
            {formatStatus(project.status)}
          </Badge>
        </div>

        <ProjectAttentionReasons
          attention={project.attention}
          className="mb-3"
        />

        <div className="mb-4 grid grid-cols-2 gap-3 border-b border-border/40 pb-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Client
            </p>
            <p className="text-sm font-semibold text-foreground">
              {project.customer.name}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Site manager
            </p>
            <p className="text-sm font-semibold text-foreground">
              {project.siteManager?.name || "Unassigned"}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span
              id={progressLabelId}
              className="text-xs font-medium text-muted-foreground"
            >
              Progress
            </span>
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {progress}%
            </span>
          </div>
          {/* Single neutral fill: how far along a project is is not a health
              signal, so the bar states the quantity and the status badge above
              carries the judgement. */}
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby={progressLabelId}
          >
            <div
              className="h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {isAdmin && (
          <div className="mb-4 grid grid-cols-4 gap-2 rounded-lg bg-muted/50 px-3 py-3 text-xs">
            <div>
              <p className="font-medium text-muted-foreground">Budget</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {hasBudget ? compactCurrency.format(budget) : "—"}
              </p>
            </div>
            <div className="text-center">
              <p className="font-medium text-muted-foreground">Cleared</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-success-ink">
                {Number.isFinite(cleared)
                  ? compactCurrency.format(cleared)
                  : "—"}
              </p>
            </div>
            <div className="text-center">
              {/* Always "Spent": the figure below is the spend either way, and
                  swapping the label for "No spend recorded" left a $0 with
                  nothing naming it. */}
              <p className="font-medium text-muted-foreground">
                {isOverBudget ? "Over budget" : "Spent"}
              </p>
              <p
                className={`font-mono text-sm font-semibold tabular-nums ${
                  isOverBudget ? "text-destructive-ink" : "text-foreground"
                }`}
              >
                {Number.isFinite(spent) ? compactCurrency.format(spent) : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium text-muted-foreground">Stages</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {completedStages}/{totalStages}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border/40 bg-muted/30 px-5 py-3">
        <Link
          href={detailsHref}
          className="inline-flex items-center gap-2 rounded-md text-xs font-semibold text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Details
          <span className="sr-only"> for {project.name}</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
