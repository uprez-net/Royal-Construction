"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";

import { readinessWarningsApply } from "@/lib/domain/projects/readiness";
import type { ProjectDetail } from "@/types/project";

type LegalRequirements = {
  pcaInspector?: string | null;
  hbcfInsuranceNumber?: string | null;
};

/**
 * The legalAdministration accordion section id on the Overview tab. Same
 * target the header's "Not set" chips use — keep them in lockstep.
 */
const LEGAL_SECTION_ID = "legalAdministration";

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/**
 * Surfaces missing HBCF / PCA on active jobs above the tabs. Those values
 * already live as warning chips in the header, but the edit path is buried in
 * an accordion — easy to glance past between site visits. This banner only
 * renders when something is actually missing; silence when compliance is set.
 */
export function ProjectComplianceAlert({
  project,
}: {
  project: ProjectDetail;
}) {
  const legal = (
    (project.requirements ?? {}) as {
      legalAdministration?: LegalRequirements;
    }
  ).legalAdministration;

  const pcaMissing = isBlank(legal?.pcaInspector);
  const hbcfMissing = isBlank(legal?.hbcfInsuranceNumber);
  if (
    !readinessWarningsApply(project.status)
    || (!pcaMissing && !hbcfMissing)
  ) {
    return null;
  }

  const missing: string[] = [];
  if (hbcfMissing) missing.push("HBCF insurance number");
  if (pcaMissing) missing.push("PCA inspector");

  const legalHref = `?activeTab=overview#${LEGAL_SECTION_ID}`;

  return (
    <aside
      role="status"
      aria-label="Compliance details still needed"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warning/40 bg-warning-light px-4 py-3 text-sm text-warning-ink shadow-sm"
    >
      {/* A 16rem basis makes the link wrap under the message on a phone. At
          basis 0 both shared one line and the message was squeezed into a
          column a word or two wide beside the link. */}
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            Compliance details still needed
          </p>
          <p className="mt-0.5 text-warning-ink/90">
            {missing.join(" and ")} {missing.length === 1 ? "is" : "are"} not
            recorded for this active project.
          </p>
        </div>
      </div>
      <Link
        href={legalHref}
        className="ml-7 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-foreground sm:ml-0 sm:min-h-0 underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Add in Legal and administration
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </aside>
  );
}
