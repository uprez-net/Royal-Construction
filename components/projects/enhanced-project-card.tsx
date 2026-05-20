"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ProjectWithStats } from "@/types/project";
import { Badge } from "@/components/ui/badge";

interface EnhancedProjectCardProps {
  project: ProjectWithStats;
  onDetailsClick?: (projectId: string) => void;
}

const statusConfig: Record<
  string,
  { bg: string; text: string; stripe: string }
> = {
  ON_TRACK: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    stripe: "bg-emerald-500",
  },
  NEEDS_ATTENTION: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    stripe: "bg-amber-500",
  },
  DELAYED: {
    bg: "bg-red-100",
    text: "text-red-700",
    stripe: "bg-red-500",
  },
  ACTIVE: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    stripe: "bg-blue-500",
  },
};

const getProgressColor = (progress: number) => {
  if (progress >= 60) return "bg-emerald-500";
  if (progress >= 30) return "bg-teal-500";
  if (progress >= 15) return "bg-amber-500";
  return "bg-red-500";
};

export function EnhancedProjectCard({
  project,
  onDetailsClick,
}: EnhancedProjectCardProps) {
  const config = statusConfig[project.status] || statusConfig.ACTIVE;
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  const spentPercent = Math.round((spent / budget) * 100);
  const progressColor = getProgressColor(project.progressPercent);

  return (
    <div
      className="group rounded-lg border border-border bg-white shadow-sm transition-all hover:shadow-md hover:-translate-y-1 overflow-hidden"
      onClick={() => {
        if (onDetailsClick) {
          onDetailsClick(project.id);
        }
      }}
    >
      {/* Top Stripe */}
      <div className={`h-1 ${config.stripe}`} />

      {/* Card Body */}
      <div className="p-5">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground text-base leading-snug">
              {project.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              📍 {project.location}
            </p>
          </div>
          <Badge
            className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${config.bg} ${config.text}`}
          >
            {project.status
              .split("_")
              .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
              .join(" ")}
          </Badge>
        </div>

        {/* Client & Manager Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b border-border/40">
          <div className="text-xs">
            <p className="text-muted-foreground font-medium mb-1">Client</p>
            <p className="font-semibold text-sm text-foreground">
              {project.customer.name}
            </p>
          </div>
          <div className="text-xs">
            <p className="text-muted-foreground font-medium mb-1">
              Site Manager
            </p>
            <p className="font-semibold text-sm text-foreground">
              {project.siteManager?.name || "Unassigned"}
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-medium">
              Progress
            </span>
            <span
              className={`text-xs font-bold ${
                project.progressPercent >= 60
                  ? "text-emerald-600"
                  : project.progressPercent >= 30
                    ? "text-teal-600"
                    : project.progressPercent >= 15
                      ? "text-amber-600"
                      : "text-red-600"
              }`}
            >
              {project.progressPercent}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${progressColor} transition-all`}
              style={{ width: `${project.progressPercent}%` }}
            />
          </div>
        </div>

        {/* Budget & Spending */}
        <div className="grid grid-cols-3 gap-2 mb-4 py-3 px-3 bg-muted/50 rounded-lg text-xs">
          <div>
            <p className="text-muted-foreground font-medium">Budget</p>
            <p className="font-bold text-foreground text-sm">
              ${Math.round(budget / 1000)}K
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground font-medium">Spent</p>
            <p
              className={`font-bold text-sm ${spentPercent > 80 ? "text-red-600" : "text-foreground"}`}
            >
              ${Math.round(spent / 1000)}K
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground font-medium">Milestones</p>
            <p className="font-bold text-foreground text-sm">
              {project.completedMilestoneCount}/{project.milestoneCount}
            </p>
          </div>
        </div>
      </div>

      {/* Footer - Details Button */}
      <div className="px-5 py-3 border-t border-border/40 bg-muted/30 flex items-center justify-end">
        <Link
          href={`/projects/${project.id}`}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="inline-flex items-center gap-2 text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors group-hover:gap-3"
        >
          Details
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
