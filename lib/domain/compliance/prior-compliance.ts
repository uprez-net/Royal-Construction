import {
  CertifierEngagementStatus,
  GraphMailbox,
  Prisma,
  ProjectStatus,
} from "@prisma/client";

import { generateCertifierRefToken } from "@/lib/graph/certifier-subject";

import { authorizeComplianceAccess } from "../access/compliance";
import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { projectHbcfCertificateFileId } from "../insurance/hbcf-claims";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import {
  BUILD_START_DOCUMENT_TYPES,
  missingBuildStartDocuments,
  type BuildStartDocument,
} from "./lifecycle";
import { isRecordedOutsideCrm } from "./recorded-outside";

// Compliance that was done before the job came into this CRM.
//
// Some jobs were already under way when the CRM was built: the certificate was
// issued and the HBCF cover taken out long ago, with no certifier thread here
// to show for it. Running them through "Connect with Certifier" would mean
// chasing a certifier for a pack they finished a year ago. Instead the office
// uploads what they hold, and the job is treated as having its compliance.
//
// It is recorded as a compliance file with no certifier on it, opened straight
// at COMPLETED. That is deliberate rather than a second store: every reader
// that asks whether a job holds its certificate already reads the compliance
// file — the Needs Attention conditions, the Overview panel, the banner, the
// HBCF mirror onto the Overview — so a certificate uploaded here satisfies all
// of them with no rule written twice. No schema change was needed: a file
// opened through Connect with Certifier always has the certifier's email, so a
// file without one can only have been recorded here (`isRecordedOutsideCrm`).

/**
 * The project statuses that mean "compliance not yet done here". A job in one
 * of them moves to ACTIVE once its prior compliance is complete; a job already
 * ACTIVE, ON_TRACK, DELAYED or COMPLETED is left where it is.
 */
const BEFORE_ACTIVE_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.COMPLIANCE_STARTED,
  ProjectStatus.COMPLIANCE_COMPLETED,
];

/**
 * Who may record compliance as done elsewhere: staff who may see the file.
 *
 * `authorizeComplianceAccess` is the read check, and it lets a customer see
 * their own project's file. Recording one moves the job to Active and clears
 * its Needs Attention items, which is the office's call, not the client's.
 */
async function authorizePriorCompliance(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
  requireEngagement: boolean,
) {
  const access = await authorizeComplianceAccess(principal, projectId, db, {
    requireEngagement,
  });
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Only staff can record a job's compliance as done.",
    );
  }
  return access;
}

/**
 * The compliance file to record prior compliance on: the one already recorded
 * this way, or a new one opened at COMPLETED with no certifier and no
 * required-document rows (there is nothing to collect).
 *
 * Refused when the project already has a certifier engaged here: its documents
 * belong on that file, through its own rows, and a job cannot be both.
 *
 * Serializable, like `startComplianceEngagement`, so two tabs uploading the
 * first document at once open one file, not a constraint error.
 */
export async function openPriorComplianceFile(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: TransactionalDomainDb,
): Promise<{ engagementId: string; opened: boolean }> {
  const { project } = await authorizePriorCompliance(
    principal,
    input.projectId,
    db,
    false,
  );

  return db.$transaction(
    async (tx) => {
      const existing = await tx.certifierEngagement.findUnique({
        where: { projectId: input.projectId },
        select: { id: true, certifierEmail: true },
      });
      if (existing) {
        if (!isRecordedOutsideCrm(existing)) {
          throw new DomainValidationError(
            "This project already has a certifier engaged. Upload the certificate on its compliance file instead.",
          );
        }
        return { engagementId: existing.id, opened: false };
      }

      const engagement = await tx.certifierEngagement.create({
        data: {
          projectId: input.projectId,
          refToken: generateCertifierRefToken(),
          subjectAddress: project.location,
          certifierEmail: null,
          graphMailbox: GraphMailbox.ADMIN,
          status: CertifierEngagementStatus.COMPLETED,
        },
        select: { id: true },
      });
      return { engagementId: engagement.id, opened: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Moves the job to ACTIVE once its prior compliance is complete.
 *
 * Complete means what it means everywhere else: nothing the build may not
 * start without is missing (`missingBuildStartDocuments`) — a construction
 * certificate or CDC on the file, and the HBCF certificate on the file or on
 * the project. A job still short of one keeps its status, and the answer says
 * what is missing so the screen can say it too.
 *
 * Guarded on the status it moves from, so a job already ACTIVE, DELAYED or
 * finished is never moved, and a repeat call is a no-op.
 */
export async function activateAfterPriorCompliance(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<{
  status: ProjectStatus;
  activated: boolean;
  missing: BuildStartDocument[];
}> {
  await authorizePriorCompliance(principal, input.projectId, db, true);

  const project = await db.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: {
      status: true,
      requirements: true,
      certifierEngagement: {
        select: {
          certifierEmail: true,
          documents: {
            where: { documentType: { in: [...BUILD_START_DOCUMENT_TYPES] } },
            select: {
              documentType: true,
              _count: { select: { files: true } },
            },
          },
        },
      },
    },
  });
  if (!isRecordedOutsideCrm(project.certifierEngagement)) {
    throw new DomainValidationError(
      "This project's compliance is being run with a certifier, so it is not recorded as done elsewhere.",
    );
  }

  const held = new Set(
    (project.certifierEngagement?.documents ?? [])
      .filter((document) => document._count.files > 0)
      .map((document) => document.documentType),
  );
  const legal = (
    project.requirements as { legalAdministration?: unknown } | null
  )?.legalAdministration as Parameters<typeof projectHbcfCertificateFileId>[0];
  const missing = missingBuildStartDocuments(
    held,
    projectHbcfCertificateFileId(legal) !== null,
  );
  if (missing.length > 0 || !BEFORE_ACTIVE_STATUSES.includes(project.status)) {
    return { status: project.status, activated: false, missing };
  }

  const moved = await db.project.updateMany({
    where: {
      id: input.projectId,
      status: { in: [...BEFORE_ACTIVE_STATUSES] },
    },
    data: { status: ProjectStatus.ACTIVE },
  });
  return {
    status: moved.count === 1 ? ProjectStatus.ACTIVE : project.status,
    activated: moved.count === 1,
    missing,
  };
}
