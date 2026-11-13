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
 * Nothing is stored, so there is nothing to dismiss or forget to clear.
 *
 * Silent when nothing is overdue, like the project page's own Alerts card: an
 * empty panel on every quiet morning trains people to stop looking at it.
 */

/** How many projects show before "Show all". */
const VISIBLE_PROJECTS = 5;

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
    <li className="rounded-[10px] border border-destructive/30 bg-destructive-light/40 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive-ink"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
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
            {project.location} · {project.customerName}
          </p>
          <p className="text-sm text-foreground">
            <span className="font-medium">{worst.name}</span> was due{" "}
            {formatSydneyDate(new Date(worst.expectedCompletion))} —{" "}
            <span className="font-semibold text-destructive-ink">
              {days(worst.daysOverdue)} overdue
            </span>
          </p>
          {others.length > 0 && expanded ? (
            <ul
              className="space-y-0.5 pt-1 text-xs text-muted-foreground"
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
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {others.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? (
                <ChevronUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
              {expanded ? "Hide" : `${others.length} more overdue`}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={href}>Open project</Link>
          </Button>
        </div>
      </div>
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
        className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-light/40 px-4 py-3"
      >
        <AlertTriangle
          className="size-4 shrink-0 text-destructive-ink"
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
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle
          as="h2"
          className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-destructive-ink" aria-hidden="true" />
          Alerts
          <StatusPill tone="danger">
            {overdue.length} {overdue.length === 1 ? "project" : "projects"}{" "}
            overdue
          </StatusPill>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        <ul className="space-y-2" aria-label="Overdue projects">
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
