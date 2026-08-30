import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
} from "@prisma/client";

import {
  isRequiredDocumentType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  certifierEmailAttachments,
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

/** Whether every required document now has a file behind it. */
export function isRequiredPackComplete(
  engagement: CertifierEngagementDetail,
): boolean {
  return REQUIRED_COMPLIANCE_DOCUMENTS.every((required) =>
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
