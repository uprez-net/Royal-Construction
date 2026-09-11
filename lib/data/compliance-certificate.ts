"use server";

import {
  CertifierEngagementStatus,
  ComplianceDocumentType,
  ProjectStatus,
} from "@prisma/client";
import { revalidateTag } from "next/cache";

import { notifyCompliance } from "@/lib/compliance/notify";
import { CERTIFICATE_DOCUMENT_TYPES } from "@/lib/compliance/portal-certificates";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { logAction } from "./actionLog";

/**
 * The end of the compliance file.
 *
 * Two documents and one status change. The certifier issues the construction
 * certificate once every checklist line has passed; the builder puts the HBCF
 * certificate of insurance on the file; and with both there the project is
 * compliance-complete and the build can start.
 *
 * A module of its own rather than more of lib/data/compliance.ts, because what
 * it touches is not the compliance file — it is the project. This is the one
 * place in the compliance flow that writes `Project.status`, and putting that
 * in the module that already owns documents, uploads and approvals would bury
 * it.
 *
 * Both functions are idempotent and both run behind something that has already
 * succeeded, so neither throws. A certificate is on the file whether or not the
 * status move landed, and an insurance certificate that is stored but has not
 * yet moved the project is visibly incomplete rather than lost.
 */

function revalidate(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`compliance-${projectId}`, CACHE_PROFILES.SHORT);
}

/**
 * The statuses a project can be moved out of by the compliance file.
 *
 * DRAFT and COMPLIANCE_STARTED are the two a job on this path can be sitting
 * on. Everything else is deliberately excluded: a project somebody has already
 * marked DELAYED, or that has begun and is ACTIVE, must not be dragged
 * backwards by a document arriving late — and one already COMPLETED is finished
 * in a stronger sense than this.
 *
 * Guarded in the query rather than checked first, so two writes landing at once
 * cannot both decide they are the one making the move.
 */
const COMPLIANCE_STAGE_STATUSES = [
  ProjectStatus.DRAFT,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.COMPLIANCE_STARTED,
] as const;

/**
 * Moves the engagement on when either certificate lands.
 *
 * Renamed from `recordConstructionCertificate`, and the rename is the point: a
 * complying development job never gets a construction certificate. It gets a
 * CDC, which carries planning and building approval together, and a file holds
 * one or the other — so a function named after one of them was only ever going to
 * be right about half the jobs on the system.
 *
 * Called from the upload path, which is now the ordinary route rather than the
 * exception: the certificate is determined on the NSW Planning Portal and
 * downloaded from it, so somebody puts it on the file by hand. Still called from
 * the inbound workflow too, for the certifier who forwards it on the thread as a
 * courtesy.
 *
 * The status move is guarded rather than assigned, so a second copy of the same
 * certificate arriving does not re-announce it, and an engagement that has
 * already been completed is not dragged back a stage.
 */
export async function recordCertificateIssued(params: {
  id: string;
  projectId: string;
}): Promise<void> {
  try {
    const claim = await prisma.certifierEngagement.updateMany({
      where: {
        id: params.id,
        // Only from the stages that precede it. APPROVED is the ordinary
        // predecessor -- every checklist line passed, which is what makes a
        // certifier willing to issue -- and the two before it are here for the
        // certifier who issues without every row having been ticked off on our
        // side, which happens when they are working from their own copy.
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

    if (claim.count === 0) {
      // Already past this, or not yet at it. Either way there is nothing to
      // announce: the certificate is on the file, which is what mattered.
      return;
    }

    revalidate(params.projectId);

    await logAction(
      createActivityLogEntry("complianceCertificateIssued", {
        projectId: params.projectId,
        engagementId: params.id,
      }),
    );

    await notifyCompliance(
      "complianceCertificateIssued",
      params.projectId,
      {},
    );
  } catch (error) {
    console.error(
      `Could not record the complying development certificate on ${params.projectId}`,
      error,
    );
  }
}

/**
 * Closes the compliance file once the certificate and the cover are both on it.
 *
 * Runs behind every compliance upload rather than only behind the insurance
 * one, and reads both documents rather than trusting the upload that triggered
 * it. The two can arrive in either order — a builder who raised the HBCF cover
 * months ago has it on the file long before the certifier issues anything — so
 * "the last one to land closes it" is the only rule that works from both ends.
 *
 * The engagement move and the project move are separate on purpose. The
 * engagement is the compliance file's own state; `Project.status` is what the
 * list and the header read, and a job whose compliance is finished is not
 * active until somebody starts a milestone on it. COMPLIANCE_COMPLETED is that
 * gap, and it is a real one — it is where a job waits for its start date.
 */
export async function closeComplianceIfComplete(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  try {
    const documents = await prisma.complianceDocument.findMany({
      where: {
        engagementId: params.engagementId,
        documentType: {
          in: [
            ...CERTIFICATE_DOCUMENT_TYPES,
            ComplianceDocumentType.HOME_INSURANCE,
          ],
        },
      },
      select: { documentType: true, _count: { select: { files: true } } },
    });

    const held = new Set(
      documents
        .filter((document) => document._count.files > 0)
        .map((document) => document.documentType),
    );

    /**
     * Either certificate closes the file, and that is the bug this fixes.
     *
     * This asked for CONSTRUCTION_CERTIFICATE by name. A complying development
     * job never gets one — it gets a CDC — so on the CDC path the upload moved
     * the engagement to CERTIFICATE_ISSUED and then this returned early on every
     * subsequent call, forever, waiting for a document that does not exist on
     * that route. The job sat one step from done with its certificate and its
     * HBCF cover both on the file, which is precisely the state the rest of this
     * module is written to prevent.
     *
     * Read as "any certificate" rather than "the certificate this file should
     * have", deliberately. Which kind a job ends on is a derived reading of the
     * route it took, and a mismatch between that reading and the document
     * actually issued must not be able to hold a finished file open: the
     * certificate in hand is the stronger evidence, which is the same ordering
     * `certificateKindFor` takes.
     */
    const hasCertificate = CERTIFICATE_DOCUMENT_TYPES.some((type) =>
      held.has(type),
    );

    if (!hasCertificate || !held.has(ComplianceDocumentType.HOME_INSURANCE)) {
      return;
    }

    /**
     * The claim and the status move, together or not at all.
     *
     * They were two statements, and the claim is the idempotency guard — so a
     * failure between them was unrecoverable rather than merely untidy. The
     * engagement went COMPLETED, the project kept its old status, and the
     * retry found `claim.count === 0` and returned early: the project status
     * was never corrected, and no activity entry or notification was written
     * either. That status is what the project list and the header read, so the
     * job showed as still in compliance forever.
     *
     * In one transaction the claim rolls back with the write it guards, and the
     * retry re-enters and finishes the job.
     */
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.certifierEngagement.updateMany({
        where: {
          id: params.engagementId,
          status: { not: CertifierEngagementStatus.COMPLETED },
        },
        data: { status: CertifierEngagementStatus.COMPLETED },
      });

      if (claim.count === 0) {
        // Already closed. Two uploads landing together would otherwise both
        // find the file complete and both announce it.
        return false;
      }

      await tx.project.updateMany({
        where: {
          id: params.projectId,
          status: { in: [...COMPLIANCE_STAGE_STATUSES] },
        },
        data: { status: ProjectStatus.COMPLIANCE_COMPLETED },
      });

      return true;
    });

    if (!claimed) return;

    revalidate(params.projectId);

    await logAction(
      createActivityLogEntry("complianceCompleted", {
        projectId: params.projectId,
        engagementId: params.engagementId,
      }),
    );

    await notifyCompliance("complianceCompleted", params.projectId, {});
  } catch (error) {
    console.error(
      `Could not close the compliance file on ${params.projectId}`,
      error,
    );
  }
}

/**
 * Marks a project as having started its compliance file.
 *
 * Called when the certifier is engaged, which is the first thing on this whole
 * flow that involves anybody outside the office — everything before it is
 * collecting documents, and a job that has collected two documents is not
 * meaningfully under way.
 *
 * Only ever moves forward, and only from the two statuses a project can be
 * sitting on before it: a job somebody has flagged DELAYED, or that is already
 * building, is not dragged back by a compliance file opening late on it.
 */
export async function recordComplianceStarted(
  projectId: string,
): Promise<void> {
  try {
    await prisma.project.updateMany({
      where: {
        id: projectId,
        status: { in: [ProjectStatus.DRAFT, ProjectStatus.NEEDS_ATTENTION] },
      },
      data: { status: ProjectStatus.COMPLIANCE_STARTED },
    });
    revalidate(projectId);
  } catch (error) {
    console.error(
      `Could not mark compliance as started on ${projectId}`,
      error,
    );
  }
}
