// Shared required-pack selection and sent-state policy.
import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import {
  coveringDocumentType,
  isOptionalForOutreach,
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
 * Whether the certifier has the copy currently attached to one document row.
 *
 * Read from the outbound mail trail rather than from the document status. A
 * replacement keeps the row but changes its file URL, so this deliberately
 * becomes false again until the replacement itself is sent. That gives the UI
 * and the server the same durable answer without maintaining a second sent
 * flag that could drift away from what was actually emailed.
 */
export function hasSentCurrentDocument(
  engagement: CertifierEngagementDetail,
  document: ComplianceDocumentWithFiles,
): boolean {
  if (document.files.length === 0) return false;
  const sent = sentToCertifierUrls(engagement);
  return document.files.every((file) => sent.has(file.url));
}

function hasFileFor(
  engagement: Pick<CertifierEngagementDetail, "documents">,
  documentType: ComplianceDocumentType,
): boolean {
  return engagement.documents.some(
    (document) =>
      document.documentType === documentType && document.files.length > 0,
  );
}

/**
 * Whether a later document on this file stands in for this one.
 *
 * True only when this row is empty and the covering row is not — today, no
 * preliminary plans and a full architectural design on file. See COVERED_BY in
 * constants/complianceDocuments.ts for why the one covers the other.
 *
 * Off files rather than status, the same evidence `missingOutreachDocuments`
 * counts with, so the send and the rows cannot disagree about whether the full
 * design is actually there.
 */
export function isCoveredOnFile(
  engagement: Pick<CertifierEngagementDetail, "documents">,
  documentType: ComplianceDocumentType,
): boolean {
  const covering = coveringDocumentType(documentType);
  return (
    covering !== null
    && !hasFileFor(engagement, documentType)
    && hasFileFor(engagement, covering)
  );
}

/**
 * Whether the architect's plans are on the file, at either stage.
 *
 * What the architect's clocks, the stage header and the client-approval control
 * mean by "the plans are in". They used to read the preliminary row alone, so a
 * file holding only the full design showed the architect as still drawing,
 * raised an overdue alert for a set that was never coming, and never offered
 * the client-approval control — which left the certifier send shut behind it
 * for good.
 */
export function hasArchitectPlansOnFile(
  engagement: Pick<CertifierEngagementDetail, "documents">,
): boolean {
  return (
    hasFileFor(
      engagement,
      ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    )
    || isCoveredOnFile(
      engagement,
      ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    )
  );
}

/**
 * The required documents this particular file still has to produce.
 *
 * Normally all six, and two things take one out.
 *
 * An open DA_APPROVAL_REQUIRED alert drops the 10.7 planning certificate: once
 * the architect says the proposal needs development approval the job is no
 * longer a CDC, and a certificate ordered to hand to a certifier is not part of
 * the path any more. Asking for it anyway left the pack permanently one
 * document short and the outreach permanently refused.
 *
 * A full architectural design on a file with no preliminary plans drops the
 * preliminary plans, for the same reason: they are never going to be drawn, and
 * the full set is everything they would have shown. See `isCoveredOnFile`.
 *
 * Read by everything that counts the pack — the progress pill, the completion
 * prompt, the send, the server-side guard on the send, and the line in the
 * certifier's email naming what is still to come — so that none of them can
 * hold the file to a document the others have written off.
 */
export function applicableRequiredDocuments(
  engagement: Pick<CertifierEngagementDetail, "alerts" | "documents">,
): readonly RequiredComplianceDocument[] {
  const needsCertificate = requiresPlanningCertificate(engagement);
  return REQUIRED_COMPLIANCE_DOCUMENTS.filter(
    (required) =>
      (needsCertificate
        || required.type !== ComplianceDocumentType.PLANNING_CERTIFICATE_10_7)
      && !isCoveredOnFile(engagement, required.type),
  );
}

/**
 * The documents the first outreach actually waits for.
 *
 * The applicable set minus the ones the certifier does not need in order to
 * start — today that is the full architectural design, which is what the job is
 * built from rather than what it is assessed on. See OPTIONAL_FOR_OUTREACH.
 *
 * Separate from `applicableRequiredDocuments` because the two answer different
 * questions. That one is "what does this file owe" — which still includes the
 * full design, and still chases it. This one is "can the certifier be asked
 * yet".
 */
export function outreachRequiredDocuments(
  engagement: Pick<CertifierEngagementDetail, "alerts" | "documents">,
): readonly RequiredComplianceDocument[] {
  return applicableRequiredDocuments(engagement).filter(
    (required) => !isOptionalForOutreach(required.type),
  );
}

/**
 * Required documents the outreach is still waiting on.
 *
 * The one reading the send guard and the button both take, so a button offering
 * a send the server then refuses — or refusing one the button offers — cannot
 * happen.
 */
export function missingOutreachDocuments(
  engagement: CertifierEngagementDetail,
): readonly RequiredComplianceDocument[] {
  return outreachRequiredDocuments(engagement).filter(
    (required) => !hasFileFor(engagement, required.type),
  );
}

/**
 * Whether the pack has everything the certifier needs to be asked.
 *
 * Measured against the outreach set, not the whole pack: a file waiting only on
 * the full architectural design is ready to send, and reading it the other way
 * left the send unreachable and the completion prompt silent over a document
 * the certifier was never going to wait for.
 */
export function isRequiredPackComplete(
  engagement: CertifierEngagementDetail,
): boolean {
  return missingOutreachDocuments(engagement).length === 0;
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
