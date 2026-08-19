"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Phone,
  Printer,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatStatus,
  projectStatusConfig,
} from "@/components/projects/project-status";
import { HbcfCapacityBadge } from "@/components/projects/detail/hbcf-capacity-badge";
import type { ProjectDetail } from "@/types/project";
import { dateFormat } from "@/utils/formatters";

type ProjectRequirementsHeader = {
  legalAdministration?: {
    siteAddress?: string | null;
    signedDate?: string | null;
    pcaInspector?: string | null;
    insuranceClaimStartDate?: string | null;
    insuranceClaimEndDate?: string | null;
  };
};

/**
 * `signedDate` is a free-text field on the extraction payload, so it may or may
 * not be a parseable date. Format it when it is; fall through to the raw string
 * when it isn't, rather than rendering "Invalid Date".
 *
 * Returns `null` when there is no value, so the caller can render the "Not set"
 * placeholder as prose. Previously this returned the string "Not set" and the
 * caller wrapped the result in `font-mono tabular-nums` unconditionally, so the
 * placeholder rendered in monospace and read like recorded data.
 */
function formatSignedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
}

/** Mono is for facts. A missing value is prose, not a fact. */
const NOT_SET = "Not set";

export function ProjectHeader({ project }: { project: ProjectDetail }) {
  const requirements = (project.requirements ??
    {}) as ProjectRequirementsHeader;
  const signedDate = formatSignedDate(
    requirements.legalAdministration?.signedDate,
  );
  const statusTone = projectStatusConfig(project.status);

  return (
    <section className="rounded-xl border border-border/70 bg-card p-6 px-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to all projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight text-foreground">
              {project.name}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusTone.badge}`}
            >
              <span
                className={`mr-1.5 inline-block size-2.5 rounded-full ${statusTone.stripe}`}
                aria-hidden="true"
              />
              {formatStatus(project.status)}
            </span>
            {/* Sits beside the status because it qualifies the same thing: what
                state this project is in. Absent unless the pool is breached. */}
            <HbcfCapacityBadge projectId={project.id} />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {requirements.legalAdministration?.siteAddress ||
                project.location}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Signed{" "}
              {signedDate ? (
                <span className="font-mono tabular-nums">{signedDate}</span>
              ) : (
                NOT_SET
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              PCA {requirements.legalAdministration?.pcaInspector || NOT_SET}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {project.customer.name}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden="true" />
              <a
                href={`tel:${project.customer.phone.replace(/\s+/g, "")}`}
                className="rounded-md font-mono tabular-nums text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {project.customer.phone}
              </a>
            </span>
            <span aria-hidden="true">|</span>
            <a
              href={`mailto:${project.customer.email}`}
              className="rounded-md text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {project.customer.email}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="h-9 rounded-lg px-3.5 text-sm font-medium"
          >
            <Printer className="mr-1.5 size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>
    </section>
  );
}
