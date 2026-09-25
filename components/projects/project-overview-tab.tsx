import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRightCircle, CalendarCheck, MapPin, Phone } from "lucide-react";

import { ProjectWithStats } from "@/types/project";
import { compactCurrency, dateFormat } from "@/utils/formatters";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
import { Button } from "../ui/button";
import type { TabType } from "./project-detail-modal";
import { formatStatus, projectStatusConfig } from "./project-status";
import { projectDetailHref } from "./projects-list-url";

interface ProjectOverviewTabProps {
  isAdmin: boolean;
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
  isAdmin,
  project,
  setActiveTab,
  onClose,
}: ProjectOverviewTabProps) {
  // The quick view also opens from the dashboard; only the Projects list has
  // a place in its URL worth returning to.
  const searchParams = useSearchParams();
  const fromList = usePathname() === "/projects";
  const detailsHref = projectDetailHref(
    project.id,
    fromList ? searchParams.toString() : "",
  );
  // A missing or non-numeric Decimal string must not reach the formatter: it
  // rendered "$NaN" in the tiles and "NaN%" in the label.
  const spentValue = Number(project.spent);
  const budgetValue = Number(project.totalBudget);
  const spent = Number.isFinite(spentValue) ? spentValue : null;
  const budget = Number.isFinite(budgetValue) ? budgetValue : null;
  // Guard the denominator too: a project with no budget set would otherwise
  // render NaN% here and an NaN-width bar below.
  const spentPercent =
    budget !== null && budget > 0 && spent !== null
      ? Math.round((spent / budget) * 100)
      : null;
  const remaining = budget !== null && spent !== null ? budget - spent : null;
  const status =
    budget !== null && spent !== null ? getBudgetStatus(budget, spent) : null;
  const isOverBudget = status === "OVER_BUDGET";
  const isNotStarted = status === "NOT_STARTED";
  // With a budget recorded, "no spend yet" means all of it is still remaining.
  // The tile used to show "—" there, hiding a figure it could state exactly.
  // Null only when there is no budget to draw down from.
  const remainingToShow = budget !== null && budget > 0 ? remaining : null;

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(project.progressPercent ?? 0)),
  );

  const customerPhone = project.customer.phone?.trim();
  const telHref = customerPhone
    ? `tel:${customerPhone.replace(/\s+/g, "")}`
    : null;
  const customerEmail = project.customer.email?.trim();
  const statusConfig = projectStatusConfig(project.status);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    project.location,
  )}`;

  return (
    <div className="space-y-6">
      {/* Budget summary */}
      {isAdmin && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-medium text-muted-foreground">Budget</p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground tabular-nums">
              {budget !== null ? compactCurrency.format(budget) : "—"}
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
              {spent !== null ? compactCurrency.format(spent) : "—"}
            </p>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {isOverBudget
                ? "Over budget"
                : remainingToShow !== null
                  ? "Remaining"
                  : budget !== null && budget > 0
                    ? "No spend recorded"
                    : "No budget recorded"}
            </p>
            <p
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                isOverBudget
                  ? "text-destructive-ink"
                  : isNotStarted
                    ? "text-foreground"
                    : "text-success-ink"
              }`}
            >
              {remainingToShow !== null
                ? compactCurrency.format(Math.abs(remainingToShow))
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Progress */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Overall progress
          </p>
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
          activities completed
        </p>
      </div>

      {/* Details */}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer">{project.customer.name}</Field>

        <Field label="Customer phone">
          {customerPhone && telHref ? (
            <a
              href={telHref}
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
          <Link href={detailsHref}>
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

        {telHref ? (
          <Button asChild variant="outline" size="lg">
            <a href={telHref}>
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
