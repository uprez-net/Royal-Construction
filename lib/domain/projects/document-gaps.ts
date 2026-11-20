import type { ComplianceDocumentType, ProjectStatus } from "@prisma/client";

import { missingBuildStartDocuments } from "../compliance/lifecycle";
import { projectHbcfCertificateFileId } from "../insurance/hbcf-claims";
import {
  collectProjectDateBlockers,
  readinessWarningsApply,
} from "./readiness";

/**
 * The HBCF certificate the project holds of its own, as the legal block
 * records it. An Overview-tab upload lands here and counts as held, wherever
 * else it did or did not reach (`missingBuildStartDocuments`).
 */
type HbcfCertificateReference = Partial<
  Pick<
    NonNullable<Parameters<typeof projectHbcfCertificateFileId>[0]>,
    "hbcfInsuranceDocument" | "hbcfClaimDocuments"
  >
>;

// The documents a project is missing, one entry each.
//
// This is the missing-document condition of Needs Attention
// (`assessProjectAttention`). The projects list's "Needs attention because"
// column, the project's Overview tab and the banner above its tabs all read
// it, so the list can never call a project short of a document the project
// page does not mention, or the other way round.

export type ProjectDocumentGapId =
  | "construction_certificate_missing"
  | "hbcf_certificate_missing"
  | "signed_date_unparseable"
  | "pca_missing"
  | "hbcf_missing";

export type ProjectDocumentGap = {
  readonly id: ProjectDocumentGapId;
  /**
   * The gap in a few precise words, naming the document and the value at
   * fault: `Signed date "TBC" is not a date`.
   */
  readonly title: string;
  /** What is wrong and why it matters, as a sentence an operator can act on. */
  readonly detail: string;
  /**
   * Where it is put right: a dotted path into the project payload for the
   * readiness gaps, `certifierEngagement.documents` for a certificate.
   */
  readonly fieldPath: string;
};

export type ProjectDocumentGapsInput = {
  readonly status: ProjectStatus | string;
  /** Any activity has started on site (`hasWorkStarted`). */
  readonly started: boolean;
  readonly legal:
    | ({
        readonly signedDate: string | null | undefined;
        readonly pcaInspector: string | null | undefined;
        readonly hbcfInsuranceNumber: string | null | undefined;
      } & HbcfCertificateReference)
    | null;
  /** Compliance document types with at least one file on them. */
  readonly heldDocuments: ReadonlySet<ComplianceDocumentType>;
};

const BUILD_START_GAP = {
  "construction certificate": {
    id: "construction_certificate_missing",
    title: "No construction certificate (or CDC) on file, but work has started",
    detail:
      "Work has started on site, but no construction certificate or complying development certificate has been uploaded to the compliance file.",
  },
  "HBCF certificate": {
    id: "hbcf_certificate_missing",
    title: "No HBCF certificate on file, but work has started",
    detail:
      "Work has started on site, but no HBCF home-warranty certificate has been uploaded, on the Overview tab or the compliance file.",
  },
} as const;

function readinessTitle(
  id: ProjectDocumentGapId,
  signedDate: string | null | undefined,
): string | null {
  switch (id) {
    case "pca_missing":
      return "No PCA inspector assigned";
    case "hbcf_missing":
      return "No HBCF insurance number recorded";
    case "signed_date_unparseable":
      return `Signed date "${signedDate?.trim() ?? ""}" is not a date`;
    default:
      return null;
  }
}

/**
 * Every document gap on one project, certificates first.
 *
 * Documents follow the stage: before anything has started on site, chasing the
 * certificate and the HBCF cover is the compliance file's job, and its own
 * overdue alerts say when one is late. Once work has started they are documents
 * the build is going on without.
 *
 * The readiness warns (PCA inspector, HBCF number, an unreadable signed date)
 * apply from day one, asked as ACTIVE whatever the stage, as creation always
 * asked it. Nothing is reported for a completed project
 * (`readinessWarningsApply`): whatever is left on it is history.
 *
 * Pure, and free of server-only imports, so the Overview tab can call it on the
 * draft it holds.
 */
export function projectDocumentGaps({
  status,
  started,
  legal,
  heldDocuments,
}: ProjectDocumentGapsInput): ProjectDocumentGap[] {
  if (!readinessWarningsApply(status)) return [];

  const gaps: ProjectDocumentGap[] = [];

  if (started) {
    const projectHoldsHbcfCertificate =
      projectHbcfCertificateFileId(legal) !== null;
    for (const missing of missingBuildStartDocuments(
      heldDocuments,
      projectHoldsHbcfCertificate,
    )) {
      gaps.push({
        ...BUILD_START_GAP[missing],
        fieldPath: "certifierEngagement.documents",
      });
    }
  }

  const warns = collectProjectDateBlockers({
    signedDate: legal?.signedDate ?? null,
    startDate: null,
    pcaInspector: legal?.pcaInspector ?? null,
    hbcfInsuranceNumber: legal?.hbcfInsuranceNumber ?? null,
    status: "ACTIVE",
  }).filter((blocker) => blocker.severity === "warn");
  for (const warn of warns) {
    const id = warn.id as ProjectDocumentGapId;
    const title = readinessTitle(id, legal?.signedDate);
    if (title) {
      gaps.push({ id, title, detail: warn.label, fieldPath: warn.fieldPath });
    }
  }

  return gaps;
}

/**
 * Gaps that are the office's to fill: HBCF, and the certificate filed on the
 * compliance file. Neither is site work, so a caller who may not see project
 * money (a site manager) is not shown them anywhere — the project page, the
 * projects list or the dashboard (owner, 2026-11-20).
 */
const OFFICE_GAP_IDS: readonly ProjectDocumentGapId[] = [
  "hbcf_missing",
  "hbcf_certificate_missing",
  "construction_certificate_missing",
];

/** The gaps a caller is shown: all of them, or the site's share. */
export function gapsVisibleTo<T extends { readonly id: ProjectDocumentGapId }>(
  gaps: readonly T[],
  financialsHidden: boolean,
): readonly T[] {
  return financialsHidden
    ? gaps.filter((gap) => !OFFICE_GAP_IDS.includes(gap.id))
    : gaps;
}
