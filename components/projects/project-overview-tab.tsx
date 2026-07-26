import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightCircle, CalendarCheck, MapPin, Phone } from "lucide-react";

import { ProjectWithStats } from "@/types/project";
import { compactCurrency, dateFormat } from "@/utils/formatters";
import { Button } from "../ui/button";
import { formatStatus, projectStatusConfig } from "./project-status";

type TabType = "overview" | "customer" | "milestones" | "financials" | "team";

interface ProjectOverviewTabProps {
  project: ProjectWithStats;
  setActiveTab: (tab: TabType) => void;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function OverviewTab({
  project,
  setActiveTab,
  onClose,
}: ProjectOverviewTabProps) {
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  // Guard the denominator: a project with no budget set would otherwise render
  // NaN% here and an NaN-width bar below.
  const spentPercent = budget > 0 ? Math.round((spent / budget) * 100) : null;
  const remaining = budget - spent;
  const isOverBudget = remaining < 0;

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(project.progressPercent ?? 0)),
  );

  const customerPhone = project.customer.phone?.trim();
  const customerEmail = project.customer.email?.trim();
  const statusConfig = projectStatusConfig(project.status);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    project.location,
  )}`;

  return (
    <div className="space-y-6">
      {/* Budget summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs font-medium text-muted-foreground">Budget</p>
          <p className="mt-1 font-mono text-lg font-semibold text-foreground tabular-nums">
            {compactCurrency.format(budget)}
          </p>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs font-medium text-muted-foreground">
            {spentPercent === null ? "Spent" : `Spent (${spentPercent}%)`}
          </p>
          <p
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              isOverBudget ? "text-destructive-ink" : "text-foreground"
            }`}
          >
            {compactCurrency.format(spent)}
          </p>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs font-medium text-muted-foreground">
            {isOverBudget ? "Over budget" : "Remaining"}
          </p>
          <p
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              isOverBudget ? "text-destructive-ink" : "text-success-ink"
            }`}
          >
            {compactCurrency.format(Math.abs(remaining))}
          </p>
        </div>
      </div>

      {/* Progress */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Overall progress</p>
          <p className="font-mono text-sm font-medium text-primary tabular-nums">
            {progressPercent}%
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Overall progress"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${progressPercent}% complete`}
          className="h-3 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {project.completedMilestoneCount} of {project.milestoneCount}{" "}
          milestones completed
        </p>
      </div>

      {/* Details */}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer">{project.customer.name}</Field>

        <Field label="Customer phone">
          {customerPhone ? (
            <a
              href={`tel:${customerPhone.replace(/\s+/g, "")}`}
              className="font-mono tabular-nums underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {customerPhone}
            </a>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Field>

        <Field label="Customer email">
          {customerEmail ? (
            <a
              href={`mailto:${customerEmail}`}
              className="break-all underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {customerEmail}
            </a>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Field>

        <Field label="Site manager">
          {project.siteManager?.name ?? (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </Field>

        <Field label="Location">{project.location}</Field>

        <Field label="Status">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.badge}`}
          >
            {formatStatus(project.status)}
          </span>
        </Field>

        <Field label="Start date">
          <span className="font-mono tabular-nums">
            {dateFormat.format(new Date(project.startDate))}
          </span>
        </Field>

        <Field label="Est. completion">
          <span className="font-mono tabular-nums">
            {dateFormat.format(new Date(project.estimatedEndDate))}
          </span>
        </Field>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" onClick={onClose}>
          <Link href={`/projects/${project.id}`}>
            <ArrowRightCircle aria-hidden="true" />
            Open full details
          </Link>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setActiveTab("milestones")}
        >
          <CalendarCheck aria-hidden="true" />
          Milestones
        </Button>

        {customerPhone ? (
          <Button asChild variant="outline" size="lg">
            <a href={`tel:${customerPhone.replace(/\s+/g, "")}`}>
              <Phone aria-hidden="true" />
              Call {project.customer.name}
            </a>
          </Button>
        ) : null}

        <Button asChild variant="outline" size="lg">
          <a href={mapsHref} target="_blank" rel="noopener noreferrer">
            <MapPin aria-hidden="true" />
            Directions
          </a>
        </Button>
      </div>
    </div>
  );
}
