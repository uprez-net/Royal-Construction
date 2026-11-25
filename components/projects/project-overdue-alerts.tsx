"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, ChevronDown, ChevronUp } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSydneyDate } from "@/lib/dates/sydney";
import type { ProjectAttention } from "@/lib/domain/projects/attention";

import { formatStatus } from "./project-status";

/**
 * Overdue projects, above the list (issue #451).
 *
 * Every number here comes from the server's attention read, which is the
 * Milestones tab's own `openOverdueDays` evaluated on Sydney's calendar — so a
 * project shows here exactly when its Milestones tab shows an Overdue badge,
 * and drops off the moment the activity is finished, waived or rescheduled.
 * Only an activity under way on a project being built counts: a job in
 * drafting or compliance, or an activity nobody has started, never shows here.
 * Nothing is stored, so there is nothing to dismiss or forget to clear.
 *
 * Silent when nothing is overdue, like the project page's own Alerts card: an
 * empty panel on every quiet morning trains people to stop looking at it.
 */

/** How many projects show before "Show all". */
const VISIBLE_PROJECTS = 3;

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function OverdueProjectRow({
  project,
  href,
}: {
  project: ProjectAttention;
  href: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [worst, ...others] = project.overdue;
  if (!worst) return null;

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <AlertTriangle
          className="size-4 shrink-0 text-warning-ink"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={href}
              className="text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {project.name}
            </Link>
            <StatusPill tone="neutral">
              {project.drafting && project.status !== "DRAFT"
                ? `${formatStatus(project.status)} · Drafting`
                : formatStatus(project.status)}
            </StatusPill>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{worst.name}</span>
            {" · due "}
            {formatSydneyDate(new Date(worst.expectedCompletion))}
            {" · "}
            <span className="font-semibold text-warning-ink">
              {days(worst.daysOverdue)} overdue
            </span>
            {" · "}
            {project.location}
            {project.customerName ? ` · ${project.customerName}` : ""}
          </p>
        </div>
        {others.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="shrink-0 text-muted-foreground"
          >
            {expanded ? (
              <ChevronUp className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
            {expanded ? "Hide" : `+${others.length} more`}
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={href}>Open</Link>
        </Button>
      </div>
      {others.length > 0 && expanded ? (
        <ul
          className="mt-1.5 space-y-0.5 pl-7 text-xs text-muted-foreground"
          aria-label={`Other overdue activities on ${project.name}`}
        >
          {others.map((activity) => (
            <li key={activity.milestoneId}>
              {activity.name} — due{" "}
              {formatSydneyDate(new Date(activity.expectedCompletion))},{" "}
              {days(activity.daysOverdue)} overdue
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ProjectOverdueAlerts({
  projects,
  failed,
  onRetry,
  hrefFor,
}: {
  /** Every project needing attention; only the overdue ones are listed. */
  projects: readonly ProjectAttention[];
  /**
   * The read failed. Said out loud, because an empty card would tell the
   * office nothing is overdue when nobody knows.
   */
  failed: boolean;
  onRetry: () => void;
  hrefFor: (projectId: string) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning-light/60 px-4 py-3"
      >
        <AlertTriangle
          className="size-4 shrink-0 text-warning-ink"
          aria-hidden="true"
        />
        <p className="flex-1 text-sm text-foreground">
          Could not load project alerts. Overdue projects may not be shown.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  const overdue = projects
    .filter((project) => project.overdue.length > 0)
    .sort(
      (a, b) =>
        (b.overdue[0]?.daysOverdue ?? 0) - (a.overdue[0]?.daysOverdue ?? 0),
    );
  if (overdue.length === 0) return null;

  const visible = showAll ? overdue : overdue.slice(0, VISIBLE_PROJECTS);

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 py-3">
        <CardTitle
          as="h2"
          className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-warning-ink" aria-hidden="true" />
          Alerts
          <StatusPill tone="warning">
            {overdue.length} {overdue.length === 1 ? "project" : "projects"}{" "}
            overdue
          </StatusPill>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/70" aria-label="Overdue projects">
          {visible.map((project) => (
            <OverdueProjectRow
              key={project.projectId}
              project={project}
              href={hrefFor(project.projectId)}
            />
          ))}
        </ul>
        {overdue.length > VISIBLE_PROJECTS ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="m-2"
            onClick={() => setShowAll((all) => !all)}
          >
            {showAll
              ? "Show fewer"
              : `Show all ${overdue.length} overdue projects`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
