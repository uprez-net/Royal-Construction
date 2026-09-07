import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import {
  isRequiredDocumentType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  type RequiredComplianceDocument,
} from "@/constants/complianceDocuments";
import {
  certifierEmailAttachments,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
  type ComplianceDocumentWithFiles,
} from "@/types/compliance";

/**
 * What the certifier does and does not have, read off one engagement.
 *
 * Three callers ask the same questions about the required pack — the Compliance
 * tab decides whether to offer the send, the prompt that opens when the pack
 * completes decides what it says, and `sendCertifierOutreach` decides what to
 * attach — and the three disagreeing is what a button offering a send that the
 * server then refuses looks like. So the questions are answered once, here, in
 * a plain module both the client and the data layer can import.
 */

/**
 * Every file URL the certifier has actually been sent.
 *
 * Off the mail trail rather than off a timestamp or a status: each outbound row
 * records the blob URL of what it carried, so this is the literal answer to
 * "have they got this file", and it survives replacements, resends and a
 * document being supplied long after the pack went.
 */
export function sentToCertifierUrls(
  engagement: CertifierEngagementDetail,
): Set<string> {
  return new Set(
    engagement.emails
      .filter((email) => email.direction === CertifierEmailDirection.OUTBOUND)
      .flatMap((email) =>
        certifierEmailAttachments(email.attachments).map((item) => item.url),
      ),
  );
}

/**
 * The required documents this particular file still has to produce.
 *
 * Normally all six. An open DA_APPROVAL_REQUIRED alert drops the 10.7 planning
 * certificate: once the architect says the proposal needs development approval
 * the job is no longer a CDC, and a certificate ordered to hand to a certifier
 * is not part of the path any more. Asking for it anyway left the pack
 * permanently one document short and the outreach permanently refused.
 *
 * Read by everything that counts the pack — the progress pill, the completion
 * prompt, the send, and the server-side guard on the send — so that none of
 * them can hold the file to a document the others have written off.
 */
export function applicableRequiredDocuments(
  engagement: Pick<CertifierEngagementDetail, "alerts">,
): readonly RequiredComplianceDocument[] {
  if (requiresPlanningCertificate(engagement)) {
    return REQUIRED_COMPLIANCE_DOCUMENTS;
  }
  return REQUIRED_COMPLIANCE_DOCUMENTS.filter(
    (required) =>
      required.type !== ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  );
}

/** Whether every required document now has a file behind it. */
export function isRequiredPackComplete(
  engagement: CertifierEngagementDetail,
): boolean {
  return applicableRequiredDocuments(engagement).every((required) =>
    engagement.documents.some(
      (document) =>
        document.documentType === required.type && document.files.length > 0,
    ),
  );
}

/**
 * Required documents holding a file the certifier has never been sent.
 *
 * Empty means they are up to date. Non-empty is either a pack that has not gone
 * yet or one where something has been replaced since it did — which of the two
 * is what `hasSentRequiredPack` answers.
 */
export function unsentRequiredDocuments(
  engagement: CertifierEngagementDetail,
): ComplianceDocumentWithFiles[] {
  const sent = sentToCertifierUrls(engagement);
  return engagement.documents.filter(
    (document) =>
      isRequiredDocumentType(document.documentType) &&
      document.files.some((file) => !sent.has(file.url)),
  );
}

/**
 * Whether the pack has already gone once.
 *
 * Read off the status rather than the mail trail because that is what the
 * outreach claims when it succeeds, and it is the same test that decides
 * whether a send opens the thread or replies on it.
 */
export function hasSentRequiredPack(
  engagement: CertifierEngagementDetail,
): boolean {
  return (
    engagement.status !== CertifierEngagementStatus.NOT_STARTED &&
    engagement.status !== CertifierEngagementStatus.COLLECTING_DOCS
  );
}

/**
 * Everything before the certifier starts issuing their checklist.
 *
 * A positive list rather than an exclusion, so a status added later to the back
 * of the flow reads as past the line rather than quietly reopening what sits
 * before it.
 */
const PRE_CHECKLIST_STATUSES: ReadonlySet<CertifierEngagementStatus> = new Set([
  CertifierEngagementStatus.NOT_STARTED,
  CertifierEngagementStatus.COLLECTING_DOCS,
  CertifierEngagementStatus.OUTREACH_SENT,
  CertifierEngagementStatus.AWAITING_RESPONSE,
  CertifierEngagementStatus.RESPONSE_RECEIVED,
  CertifierEngagementStatus.SIGNING,
]);

/**
 * Whether the certifier has started issuing their checklist.
 *
 * The one line the collection half of the tab ends at. Everything before it is
 * assembling and sending what opens the engagement; everything after is the
 * evidence against the checklist they issued, and the controls for the first
 * have no meaning in the second — extracting a checklist that already exists,
 * re-sending a pack that is no longer part of the flow, replacing a document
 * the certifier is reading right now.
 */
export function hasReachedChecklistStage(
  engagement: CertifierEngagementDetail,
): boolean {
  return !PRE_CHECKLIST_STATUSES.has(engagement.status);
}

/**
 * Whether sending the required pack is still a step this engagement has.
 *
 * The pack is what opens the engagement, and correcting it is only the same act
 * for as long as the certifier is still reading it. Once they have issued a
 * checklist they have moved on to the evidence against it, and re-sending the
 * plan set at that point is not a stage of the flow but a message about one
 * document — which the thread composer is for. Leaving the send on offer there
 * put a button on the tab that re-opened the collection step in the middle of a
 * review.
 */
export function canSendRequiredPack(
  engagement: CertifierEngagementDetail,
): boolean {
  return !hasReachedChecklistStage(engagement);
}
