import {
  CertifierEngagementStatus,
  ComplianceDocumentType,
  ProjectStatus,
} from "@prisma/client";

import { CERTIFICATE_DOCUMENT_TYPES } from "./portal-certificates";
import { authorizeComplianceMutation } from "../access/compliance";
import type { DomainDb, TransactionalDomainDb } from "../db";
import type { DomainPrincipal } from "../principal";

const COMPLIANCE_STAGE_STATUSES = [
  ProjectStatus.DRAFT,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.COMPLIANCE_STARTED,
] as const;

/** The documents a build may not start without, as the office names them. */
export type BuildStartDocument =
  | "construction certificate"
  | "HBCF certificate";

/**
 * Which of the documents a build may not start without the file does not hold
 * yet: a construction certificate (or CDC) and the HBCF home-warranty
 * certificate, each with a file on it.
 *
 * One rule, read in two places: `closeComplianceIfComplete` closes the
 * compliance stage when this is empty, and the project's Needs Attention
 * conditions flag a job that has started on site while it is not.
 */
export function missingBuildStartDocuments(
  held: ReadonlySet<ComplianceDocumentType>,
): BuildStartDocument[] {
  const missing: BuildStartDocument[] = [];
  if (!CERTIFICATE_DOCUMENT_TYPES.some((type) => held.has(type))) {
    missing.push("construction certificate");
  }
  if (!held.has(ComplianceDocumentType.HOME_INSURANCE)) {
    missing.push("HBCF certificate");
  }
  return missing;
}

/** The document types `missingBuildStartDocuments` reads, for a query. */
export const BUILD_START_DOCUMENT_TYPES: readonly ComplianceDocumentType[] = [
  ...CERTIFICATE_DOCUMENT_TYPES,
  ComplianceDocumentType.HOME_INSURANCE,
];

export async function recordComplianceCertificateIssued(
  principal: DomainPrincipal,
  input: { engagementId: string; projectId: string },
  db: DomainDb,
) {
  await authorizeComplianceMutation(principal, input.projectId, db);
  const claim = await db.certifierEngagement.updateMany({
    where: {
      id: input.engagementId,
      projectId: input.projectId,
      status: {
        in: [
          CertifierEngagementStatus.APPROVED,
          CertifierEngagementStatus.IN_REVIEW,
          CertifierEngagementStatus.CHECKLIST_TRACKING,
          CertifierEngagementStatus.INSURANCE,
        ],
      },
    },
    data: { status: CertifierEngagementStatus.CERTIFICATE_ISSUED },
  });
  return { changed: claim.count === 1 };
}

export async function closeComplianceIfComplete(
  principal: DomainPrincipal,
  input: { engagementId: string; projectId: string },
  db: TransactionalDomainDb,
) {
  await authorizeComplianceMutation(principal, input.projectId, db);
  const documents = await db.complianceDocument.findMany({
    where: {
      engagementId: input.engagementId,
      engagement: { projectId: input.projectId },
      documentType: { in: [...BUILD_START_DOCUMENT_TYPES] },
    },
    select: { documentType: true, _count: { select: { files: true } } },
  });
  const held = new Set(
    documents
      .filter((document) => document._count.files > 0)
      .map((document) => document.documentType),
  );
  if (missingBuildStartDocuments(held).length > 0) {
    return {
      completed: false as const,
      reason: "documents-outstanding" as const,
    };
  }

  const completed = await db.$transaction(async (tx) => {
    const claim = await tx.certifierEngagement.updateMany({
      where: {
        id: input.engagementId,
        projectId: input.projectId,
        status: { not: CertifierEngagementStatus.COMPLETED },
      },
      data: { status: CertifierEngagementStatus.COMPLETED },
    });
    if (claim.count === 0) return false;
    await tx.project.updateMany({
      where: {
        id: input.projectId,
        status: { in: [...COMPLIANCE_STAGE_STATUSES] },
      },
      data: { status: ProjectStatus.COMPLIANCE_COMPLETED },
    });
    return true;
  });
  return {
    completed,
    reason: completed ? ("completed" as const) : ("already-complete" as const),
  };
}
