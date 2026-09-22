import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainTransitionError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import {
  complianceDocumentLabel,
  DA_DOCUMENTS,
  isApprovableDocumentType,
} from "@/constants/complianceDocuments";
import { hasSentCurrentDocument } from "./required-pack";
import { certifierEngagementInclude } from "@/types/compliance";

// The certifier's decision on one piece of compliance evidence.
//
// Two implementations, and Eve's was missing the check that matters most:
//
//   The app refuses a decision on a document that has not been SENT to the
//   certifier yet (`hasSentCurrentDocument`). Eve did not — so an agent could
//   approve evidence nobody had ever asked the certifier to look at, and the
//   engagement would then close on an approval the certifier never made.
//
// The app's version is the canonical one. What does not come with it is the
// `after()` block: the rejection notification and the activity-log entries are
// the adapter's to fire, because `after` is a Next request concept and a cron
// or an Eve tool has no request to defer into. The result says what happened
// so an adapter can announce it accurately — including whether THIS call is
// the one that closed the engagement, which is what stops two admins
// approving the last two documents from both announcing it.

export type ResolveComplianceDocumentResult =
  | {
      readonly resolved: false;
      readonly status: ComplianceDocumentStatus;
    }
  | {
      readonly resolved: true;
      readonly status: ComplianceDocumentStatus;
      readonly documentId: string;
      readonly engagementId: string;
      readonly documentLabel: string;
      readonly approved: boolean;
      /** True only for the call that actually closed the engagement. */
      readonly engagementClosed: boolean;
    };

/**
 * Approve or reject one compliance document.
 *
 * A rejection returns the document to PENDING rather than leaving it REJECTED:
 * the UI reads status to choose between an upload control and a decision pair,
 * and the reason it keeps is what tells the admin why they are uploading
 * again.
 *
 * The conditional claim is what makes two admins clicking at once safe — the
 * second call matches nothing and is a no-op instead of overwriting the first
 * decision — and it is also what stops an already-approved document being
 * quietly reopened from a stale tab.
 */
export async function resolveComplianceDocument(
  principal: DomainPrincipal,
  params: {
    projectId: string;
    documentId: string;
    decision: "approved" | "rejected";
    rejectionReason?: string;
  },
  db: DomainDb,
): Promise<ResolveComplianceDocumentResult> {
  // Admin-only, the same gate resolving a tradie approval carries: this is the
  // decision that freezes a document or sends it back, and it must not be
  // available to the person who uploaded it.
  //
  // Deliberately NOT authorizeProject. Compliance READ access
  // (lib/compliance/access.ts) is wider than project manage scope — it includes
  // the lead's assignee and the owning customer — and narrowing the decision to
  // manage scope, or widening it to read scope, would both be changes nobody
  // asked for. The decision has always been admin-only.
  requireAdminPrincipal(principal);

  const document = await db.complianceDocument.findFirst({
    include: { files: true },
    where: {
      engagement: { projectId: params.projectId },
      id: params.documentId,
    },
  });
  if (!document) {
    throw new DomainNotFoundError(
      "Compliance document not found on this project.",
    );
  }

  const label = complianceDocumentLabel(document.documentType, document.label);

  // The certifier reviews the evidence they asked for, and nothing else. The
  // required pack and the signed copies are already theirs; approving or
  // rejecting one of those is not a decision anybody is entitled to make, and
  // the UI no longer offers it — this is what stops a stale tab, or a direct
  // call, from making it anyway and freezing a row nobody can then re-upload.
  if (!isApprovableDocumentType(document.documentType)) {
    throw new DomainTransitionError(
      `${label} is not reviewed by the certifier.`,
    );
  }

  const engagement = await db.certifierEngagement.findUnique({
    include: certifierEngagementInclude,
    where: { id: document.engagementId },
  });
  if (!engagement) {
    throw new DomainNotFoundError(
      `Certifier engagement ${document.engagementId} not found.`,
    );
  }

  // Eve had no equivalent of this. Without it an agent can decide on evidence
  // that was never sent, and the engagement closes on a review that never
  // happened.
  if (!hasSentCurrentDocument(engagement, document)) {
    throw new DomainTransitionError(
      `${label} has not been sent to the certifier yet.`,
    );
  }

  if (params.decision === "rejected" && !params.rejectionReason?.trim()) {
    throw new DomainTransitionError("A rejection reason is required.");
  }

  const approving = params.decision === "approved";

  const claim = await db.complianceDocument.updateMany({
    data: approving
      ? { rejectionReason: null, status: ComplianceDocumentStatus.APPROVED }
      : {
          rejectionReason: params.rejectionReason?.trim() ?? null,
          status: ComplianceDocumentStatus.PENDING,
        },
    where: {
      id: document.id,
      // Only a document with evidence on it can be decided. An APPROVED row is
      // frozen, and a PENDING one has nothing to judge.
      status: {
        in: [
          ComplianceDocumentStatus.UPLOADED,
          ComplianceDocumentStatus.RECEIVED,
        ],
      },
    },
  });

  if (claim.count === 0) {
    // Someone else got there first, or this tab is stale. Re-read rather than
    // assume which, so the caller can say what actually happened.
    const current = await db.complianceDocument.findUnique({
      select: { status: true },
      where: { id: document.id },
    });
    return {
      resolved: false,
      status: current?.status ?? document.status,
    };
  }

  // Every document being approved is what freezes the section, so the
  // engagement's own status follows the last decision rather than needing a
  // separate button nobody would remember to press.
  let engagementClosed = false;
  if (approving) {
    const outstanding = await db.complianceDocument.count({
      where: {
        // Checklist evidence is the whole of the review loop, so it is the
        // whole of what can hold the engagement open. Counting anything else
        // left it permanently one approval short of closing, against rows the
        // UI gives nobody a way to approve.
        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
        engagementId: document.engagementId,
        // The two ways a row can be settled. NOT_REQUIRED never becomes
        // APPROVED — nobody approves a document that was never supplied — so
        // without it here a single waved-off line holds the engagement open
        // for good.
        status: {
          notIn: [
            ComplianceDocumentStatus.APPROVED,
            ComplianceDocumentStatus.NOT_REQUIRED,
          ],
        },
      },
    });
    if (outstanding === 0) {
      engagementClosed = await advanceEngagementStatus(
        document.engagementId,
        [
          CertifierEngagementStatus.IN_REVIEW,
          CertifierEngagementStatus.CHECKLIST_TRACKING,
          CertifierEngagementStatus.INSURANCE,
        ],
        CertifierEngagementStatus.APPROVED,
        db,
      );
    }
  }

  return {
    approved: approving,
    documentId: document.id,
    documentLabel: label,
    engagementClosed,
    engagementId: document.engagementId,
    resolved: true,
    status: approving
      ? ComplianceDocumentStatus.APPROVED
      : ComplianceDocumentStatus.PENDING,
  };
}

/**
 * Move an engagement forward, only from one of the statuses named.
 *
 * Returns whether THIS call made the move. Two admins approving the last two
 * documents at once would otherwise both see zero outstanding and both
 * announce the engagement closed.
 */
export async function advanceEngagementStatus(
  engagementId: string,
  from: readonly CertifierEngagementStatus[],
  to: CertifierEngagementStatus,
  db: DomainDb,
): Promise<boolean> {
  const claim = await db.certifierEngagement.updateMany({
    data: { status: to },
    where: { id: engagementId, status: { in: [...from] } },
  });
  return claim.count === 1;
}

/** Seed the fixed Development Application rows exactly once. */
export async function ensureDevelopmentApplicationDocuments(
  engagementId: string,
  db: DomainDb,
): Promise<boolean> {
  const daTypes = DA_DOCUMENTS.map((document) => document.type);
  const existing = await db.complianceDocument.findMany({
    where: { engagementId, documentType: { in: daTypes } },
    select: { documentType: true },
  });
  const existingTypes = new Set(
    existing.map((document) => document.documentType),
  );
  const missing = DA_DOCUMENTS.filter(
    (document) => !existingTypes.has(document.type),
  );
  if (missing.length === 0) return false;

  const nextOrder = await db.complianceDocument.count({
    where: { engagementId },
  });
  await db.complianceDocument.createMany({
    data: missing.map((document, index) => ({
      engagementId,
      documentType: document.type,
      status: ComplianceDocumentStatus.PENDING,
      order: nextOrder + index,
    })),
    skipDuplicates: true,
  });
  return true;
}

/** Mark a conditional checklist/DA row unnecessary, or restore its real state. */
export async function setComplianceDocumentNotRequired(
  principal: DomainPrincipal,
  params: {
    projectId: string;
    documentId: string;
    notRequired: boolean;
  },
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  const document = await db.complianceDocument.findFirst({
    where: {
      id: params.documentId,
      engagement: { projectId: params.projectId },
    },
    select: {
      id: true,
      engagementId: true,
      documentType: true,
      label: true,
      status: true,
      _count: { select: { files: true } },
    },
  });
  if (!document) {
    throw new DomainNotFoundError(
      "Compliance document not found on this project.",
    );
  }

  const isDaDocument =
    document.documentType === ComplianceDocumentType.DA_ITEM
    || DA_DOCUMENTS.some((entry) => entry.type === document.documentType);
  const label = complianceDocumentLabel(document.documentType, document.label);
  if (
    document.documentType !== ComplianceDocumentType.CHECKLIST_ITEM
    && !isDaDocument
  ) {
    throw new DomainTransitionError(
      `${label} cannot be marked not required here.`,
    );
  }
  if (document.status === ComplianceDocumentStatus.APPROVED) {
    throw new DomainTransitionError(`${label} has already been approved.`);
  }

  const status = params.notRequired
    ? ComplianceDocumentStatus.NOT_REQUIRED
    : document._count.files > 0
      ? ComplianceDocumentStatus.UPLOADED
      : ComplianceDocumentStatus.PENDING;
  if (status === document.status) {
    return {
      changed: false as const,
      documentId: document.id,
      documentLabel: label,
      engagementId: document.engagementId,
      status,
    };
  }

  const changed = await db.complianceDocument.updateMany({
    where: { id: document.id, status: document.status },
    data: { status },
  });
  if (changed.count !== 1) {
    throw new DomainTransitionError(
      "The compliance row changed while it was being updated; refresh and retry.",
      document.status,
      status,
    );
  }
  return {
    changed: true as const,
    documentId: document.id,
    documentLabel: label,
    engagementId: document.engagementId,
    status,
  };
}
