import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import {
  complianceDocumentLabel,
  isNotRequired,
} from "@/constants/complianceDocuments";
import {
  checklistBlockedReason,
  type CertifierEngagementDetail,
  type ComplianceDocumentWithFiles,
} from "@/types/compliance";

import { DomainTransitionError, DomainValidationError } from "../errors";
import { hasSentCurrentDocument } from "./required-pack";

// Sending checklist documents to the certifier before the whole checklist is in.
//
// The certifier can verify items as they land rather than waiting for the last
// of twenty, so the office sends what it has. This used to be one email per
// row; it is now any set of rows the office ticks, in one email — a partially
// complete pack.
//
// Which rows qualify was written twice: once in the send, which refused, and
// once inline on the tab, which decided whether to show the button. This is the
// one answer both read, so a row offers a checkbox exactly when the send would
// take it.

/**
 * Why this document cannot go in an early review send, or `null` when it can.
 *
 * `null` also covers a row whose current copy the certifier already has — the
 * send skips those rather than refusing — so callers that offer a checkbox use
 * `canSelectForEarlyReview`, which leaves them out.
 */
export function earlyReviewRefusal(
  engagement: CertifierEngagementDetail,
  document: ComplianceDocumentWithFiles,
): string | null {
  const blocked = checklistBlockedReason(engagement);
  if (blocked) return blocked;
  if (document.documentType !== ComplianceDocumentType.CHECKLIST_ITEM) {
    return "Only a checklist item can be sent for early verification.";
  }
  if (isNotRequired(document.status) || document.files.length === 0) {
    return "Upload the checklist document before sending it for verification.";
  }
  if (document.status === ComplianceDocumentStatus.APPROVED) {
    return "This checklist document has already been approved.";
  }
  if (document.rejectionReason) {
    return "Upload the revised document before sending it back to the certifier.";
  }
  return null;
}

/** Whether the tab offers this row a checkbox: sendable and not yet sent. */
export function canSelectForEarlyReview(
  engagement: CertifierEngagementDetail,
  document: ComplianceDocumentWithFiles,
): boolean {
  return (
    earlyReviewRefusal(engagement, document) === null
    && !hasSentCurrentDocument(engagement, document)
  );
}

/**
 * The documents one early review send carries, in checklist order.
 *
 * Refuses the whole send if any requested row cannot go, naming it — sending
 * the rest and dropping one quietly would leave the office believing the
 * certifier has a document they were never sent. Rows whose current copy the
 * certifier already holds are left out rather than attached a second time;
 * `toSend` empty means there was nothing new to send.
 */
export function earlyReviewSelection(
  engagement: CertifierEngagementDetail,
  documentIds: readonly string[],
): {
  toSend: ComplianceDocumentWithFiles[];
  alreadySent: ComplianceDocumentWithFiles[];
} {
  const requested = new Set(documentIds);
  if (requested.size === 0) {
    throw new DomainValidationError(
      "Select at least one checklist document to send.",
      "documentIds",
    );
  }

  const documents = engagement.documents.filter((document) =>
    requested.has(document.id),
  );
  if (documents.length !== requested.size) {
    throw new DomainValidationError(
      "A selected document is no longer on this project. Refresh and try again.",
      "documentIds",
    );
  }

  for (const document of documents) {
    const refusal = earlyReviewRefusal(engagement, document);
    if (refusal) {
      throw new DomainTransitionError(
        documents.length === 1
          ? refusal
          : `${complianceDocumentLabel(document.documentType, document.label)}: ${refusal}`,
      );
    }
  }

  const ordered = [...documents].sort((a, b) => a.order - b.order);
  return {
    alreadySent: ordered.filter((document) =>
      hasSentCurrentDocument(engagement, document),
    ),
    toSend: ordered.filter(
      (document) => !hasSentCurrentDocument(engagement, document),
    ),
  };
}
