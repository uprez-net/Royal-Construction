"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";

import { DOCUMENT_ATTENTION_ID } from "@/components/projects/detail/document-attention-panel";
import { projectDocumentGaps } from "@/lib/domain/projects/document-gaps";
import { hasWorkStarted } from "@/lib/domain/projects/milestone-schedule";
import type { ProjectDetail } from "@/types/project";

type LegalRequirements = {
  signedDate?: string | null;
  pcaInspector?: string | null;
  hbcfInsuranceNumber?: string | null;
};

/**
 * The document gaps that keep this job in Needs attention, summarised above
 * the tabs so they are seen from every tab.
 *
 * It used to check the PCA inspector and HBCF number for itself, which was a
 * third copy of the readiness rule and knew nothing of an unreadable signed
 * date or a certificate missing once work had started. It now reads
 * `projectDocumentGaps`, the rule behind the projects list's "Needs attention
 * because" line, and links to the Overview tab's panel, which says how to fix
 * each one. Silent when nothing is missing.
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

  const gaps = projectDocumentGaps({
    status: project.status,
    started: hasWorkStarted(project.milestones),
    legal: {
      signedDate: legal?.signedDate,
      pcaInspector: legal?.pcaInspector,
      hbcfInsuranceNumber: legal?.hbcfInsuranceNumber,
    },
    heldDocuments: new Set(
      (project.certifierEngagement?.documents ?? [])
        .filter((document) => document.files.length > 0)
        .map((document) => document.documentType),
    ),
  });
  if (gaps.length === 0) return null;

  const panelHref = `?activeTab=overview#${DOCUMENT_ATTENTION_ID}`;

  return (
    <aside
      role="status"
      aria-label="Documents need attention"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warning/40 bg-warning-light px-4 py-3 text-sm text-warning-ink shadow-sm"
    >
      {/* A 16rem basis makes the link wrap under the message on a phone. At
          basis 0 both shared one line and the message was squeezed into a
          column a word or two wide beside the link. */}
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {gaps.length === 1
              ? "1 document needs attention"
              : `${gaps.length} documents need attention`}
          </p>
          <ul className="mt-0.5 space-y-0.5 text-warning-ink/90">
            {gaps.map((gap) => (
              <li key={gap.id}>{gap.title}</li>
            ))}
          </ul>
        </div>
      </div>
      <Link
        href={panelHref}
        className="ml-7 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-foreground sm:ml-0 sm:min-h-0 underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        See how to fix
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </aside>
  );
}
