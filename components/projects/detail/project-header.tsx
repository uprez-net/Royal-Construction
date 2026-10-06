"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Phone,
  Printer,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatStatus,
  projectStatusConfig,
} from "@/components/projects/project-status";
import { HbcfCapacityBadge } from "@/components/projects/detail/hbcf-capacity-badge";
import { SiteManagerSelector } from "@/components/projects/detail/site-manager-selector";
import { StatusPill } from "@/components/common/status-pill";
import type { ProjectDetail } from "@/types/project";
import { formatDisplayDate, normalizeDateString } from "@/utils/date";
import { UploadButton } from "@/components/common/upload-button";
import { appendFileToProject } from "@/lib/store/slices/projectsSlice";
import { useAppDispatch } from "@/lib/store/hooks";
import { projectsListHref } from "@/components/projects/projects-list-url";

type ProjectRequirementsHeader = {
  legalAdministration?: {
    siteAddress?: string | null;
    signedDate?: string | null;
    pcaInspector?: string | null;
    insuranceClaimStartDate?: string | null;
    insuranceClaimEndDate?: string | null;
    hbcfInsuranceNumber?: string | null;
  };
};

/** Mono is for facts. A missing value is prose, not a fact. */
const NOT_SET = "Not set";

/**
 * The legalAdministration accordion section id on the Overview tab, used as
 * the scroll target for the "click to add" affordances on missing PCA /
 * unverified signed date.
 */
const LEGAL_SECTION_ID = "legalAdministration";

export function ProjectHeader({
  project,
  canAssignSiteManager,
}: {
  project: ProjectDetail;
  /** Only an ADMIN may reassign; everyone else sees the name. */
  canAssignSiteManager: boolean;
}) {
  const dispatch = useAppDispatch();
  // Back to the chip and page of the list this project was opened from.
  const backToListHref = projectsListHref(useSearchParams().get("list"));
  const requirements = (project.requirements
    ?? {}) as ProjectRequirementsHeader;
  const legal = requirements.legalAdministration ?? {};

  const rawSignedDate = legal.signedDate;
  const normalizedSignedDate = rawSignedDate
    ? normalizeDateString(rawSignedDate)
    : null;
  const displaySignedDate = formatDisplayDate(rawSignedDate);
  const signedDateIsUnverified =
    Boolean(rawSignedDate) && !normalizedSignedDate;

  const pcaInspector = legal.pcaInspector;
  const hbcfInsuranceNumber = legal.hbcfInsuranceNumber;
  const hbcfInsuranceMissing =
    !hbcfInsuranceNumber || hbcfInsuranceNumber.trim() === "";
  const pcaMissing = !pcaInspector || pcaInspector.trim() === "";

  const statusTone = projectStatusConfig(project.status);
  const showPcaWarning =
    pcaMissing
    && (project.status === "ACTIVE" || project.status === "NEEDS_ATTENTION");
  const showHbcfWarning =
    hbcfInsuranceMissing
    && (project.status === "ACTIVE" || project.status === "NEEDS_ATTENTION");

  const legalSectionAnchor = `#${LEGAL_SECTION_ID}`;
  const ownerContacts = (
    requirements.legalAdministration as Record<string, unknown> | undefined
  )?.ownerContacts as
    | { names?: string[]; emails?: string[]; phones?: string[] }
    | undefined;
  const owners: { name: string; email?: string; phone?: string }[] =
    ownerContacts
      ? (ownerContacts.names ?? []).map((name, index) => ({
          name,
          email: ownerContacts.emails?.[index],
          phone: ownerContacts.phones?.[index],
        }))
      : [];

  return (
    <section className="rounded-xl border border-border/70 bg-card p-6 px-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href={backToListHref}
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
              {legal.siteAddress || project.location}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Signed (contract executed){" "}
              {displaySignedDate ? (
                signedDateIsUnverified ? (
                  <StatusPill tone="warning">
                    {displaySignedDate} — unverified
                  </StatusPill>
                ) : (
                  <span className="font-mono tabular-nums">
                    {displaySignedDate}
                  </span>
                )
              ) : (
                <Link
                  href={legalSectionAnchor}
                  className="rounded-md text-warning-ink transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {NOT_SET}
                </Link>
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              PCA{" "}
              {pcaMissing ? (
                showPcaWarning ? (
                  <Link
                    href={legalSectionAnchor}
                    aria-label="PCA inspector not set — click to add"
                    className="inline-flex items-center gap-1 rounded-md text-warning-ink transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <StatusPill tone="warning">
                      <Plus className="size-3" aria-hidden="true" />
                      Not set
                    </StatusPill>
                  </Link>
                ) : (
                  <Link
                    href={legalSectionAnchor}
                    className="rounded-md text-warning-ink transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {NOT_SET}
                  </Link>
                )
              ) : (
                <span className="font-mono tabular-nums">{pcaInspector}</span>
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span
              className="inline-flex items-center gap-1"
              key={hbcfInsuranceNumber}
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              HBCF Number{" "}
              {hbcfInsuranceMissing ? (
                showHbcfWarning ? (
                  <Link
                    href={legalSectionAnchor}
                    aria-label="HBCF number not set — click to add"
                    className="inline-flex items-center gap-1 rounded-md text-warning-ink transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <StatusPill tone="warning">
                      <Plus className="size-3" aria-hidden="true" />
                      Not set
                    </StatusPill>
                  </Link>
                ) : (
                  <Link
                    href={legalSectionAnchor}
                    className="rounded-md text-warning-ink transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {NOT_SET}
                  </Link>
                )
              ) : (
                <span className="font-mono tabular-nums">
                  {hbcfInsuranceNumber}
                </span>
              )}
            </span>
          </div>
          {/* Its own line: who runs the build is a different kind of fact
              from the contract dates and certificates above it. */}
          <SiteManagerSelector
            project={project}
            canAssign={canAssignSiteManager}
          />
          {owners.length > 0 ? (
            <div className="flex flex-col gap-1 pt-1">
              {owners.map((owner, index) => (
                <p
                  className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground"
                  key={`owner-${index}`}
                >
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="size-3.5" aria-hidden="true" />
                    {owner.name}
                  </span>
                  {owner.phone && (
                    <>
                      <span aria-hidden="true">|</span>
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3.5" aria-hidden="true" />
                        <a
                          href={`tel:${owner.phone?.replace(/\s+/g, "")}`}
                          className="rounded-md font-mono tabular-nums text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {owner.phone}
                        </a>
                      </span>
                    </>
                  )}
                  {owner.email && (
                    <>
                      <span aria-hidden="true">|</span>
                      <a
                        href={`mailto:${owner.email}`}
                        className="rounded-md text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {owner.email}
                      </a>
                    </>
                  )}
                </p>
              ))}
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5" aria-hidden="true" />
                {project.customer.name}
              </span>
              {project.customer.phone ? (
                <>
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
                </>
              ) : null}
              <span aria-hidden="true">|</span>
              <a
                href={`mailto:${project.customer.email}`}
                className="rounded-md text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {project.customer.email}
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <UploadButton
            projectId={project.id}
            maxFiles={5}
            onUpload={(uploadedFiles) => {
              uploadedFiles.forEach((file) => {
                dispatch(
                  appendFileToProject({
                    projectId: project.id,
                    file: file,
                  }),
                );
              });
            }}
          />
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
