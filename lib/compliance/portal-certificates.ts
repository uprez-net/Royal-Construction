import {
  CertifierEngagementStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";

import { isNotRequired } from "@/constants/complianceDocuments";
import {
  externalApplication,
  hasDevelopmentApplication,
  hasDevelopmentConsent,
  type CertifierEngagementDetail,
} from "@/types/compliance";

/**
 * The lodgement between the checklist passing and the certificate arriving.
 *
 * The file was built believing there was none. A certifier passed the last
 * checklist line, issued the construction certificate, and it landed on their
 * email thread like everything else they send -- which is what
 * `recordConstructionCertificate` and the certificate stage were written
 * against. None of that is how the job works.
 *
 * What actually happens is that passing the checklist is the certifier becoming
 * *willing* to certify. The certificate is then applied for on the NSW Planning
 * Portal, and three things follow from that which the file had nowhere to put:
 *
 *  1. **There are two certificates, not one.** A complying development job is
 *     built under a Complying Development Certificate, which carries planning
 *     and building approval together. A job that went to a council for consent
 *     is built under a Construction Certificate. A file holds one or the other
 *     and which one is decided by the route it took -- see `certificateKindFor`.
 *  2. **The certifier has to be appointed principal certifier.** A separate form
 *     on the portal, naming the person who will inspect the build, and a CDC
 *     cannot be determined without it. It goes in with the application.
 *  3. **The determination does not carry the certificate.** The portal emails to
 *     say the application has been approved and tells the applicant to log in
 *     and download it. Nothing is attached. So there is a real state -- approved,
 *     and holding nothing -- that no other event on this file produces, and it
 *     needs an alert of its own that is not a complaint about anybody.
 *
 * A pure module over one engagement, for the reason `stage-flow.ts` is one:
 * every answer here is read by the nightly sweep, by the tab, by the server
 * actions that gate on it and by the tests, and four readings of one gate is
 * what drift looks like. Nothing here touches the database.
 */

/** Where an admin goes to lodge, appoint and download. */
export const PLANNING_PORTAL_URL = "https://www.planningportal.nsw.gov.au/";

/**
 * The two applications whose answer is a certificate rather than a permit.
 *
 * Told apart from the other five kinds because they behave differently in two
 * places: `alreadyHeld` is meaningless on both -- nobody turns up holding the
 * certificate for a house they have not built -- and both are gated on the
 * certifier having finished, which none of the permits are.
 */
export const CERTIFICATE_APPLICATION_KINDS = [
  ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
  ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE,
] as const;

export type CertificateApplicationKind =
  (typeof CERTIFICATE_APPLICATION_KINDS)[number];

export function isCertificateApplication(
  kind: ComplianceExternalApplicationKind,
): kind is CertificateApplicationKind {
  return (
    CERTIFICATE_APPLICATION_KINDS as readonly ComplianceExternalApplicationKind[]
  ).includes(kind);
}

/**
 * The document each certificate application produces.
 *
 * Narrower than `EXTERNAL_APPLICATION_DOCUMENT_TYPE`, which answers the same
 * question for all seven kinds. This one is typed to the two certificates so a
 * caller that has already established it is looking at one of them does not have
 * to handle a null that cannot happen.
 */
export const CERTIFICATE_DOCUMENT_TYPE: Readonly<
  Record<CertificateApplicationKind, ComplianceDocumentType>
> = {
  [ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE]:
    ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
  [ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE]:
    ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
};

/**
 * Every certificate a file could close on, for the readers that want either.
 *
 * `closeComplianceIfComplete` is the one that matters: it asked for a
 * construction certificate by name, so a CDC job that uploaded its CDC moved to
 * CERTIFICATE_ISSUED and then could never reach COMPLETED, because the document
 * it was waiting for is one a complying development job never gets. A job stuck
 * one step from done forever, which is exactly the failure the comments around
 * that function say it exists to prevent.
 */
export const CERTIFICATE_DOCUMENT_TYPES: readonly ComplianceDocumentType[] = [
  ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
  ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
];

export function isCertificateDocument(
  documentType: ComplianceDocumentType,
): boolean {
  return CERTIFICATE_DOCUMENT_TYPES.includes(documentType);
}

/**
 * The alert raised when the portal approves one of these and sends no document.
 *
 * Three rather than two, because a development consent comes back exactly the
 * same way and the DA block did not know it either: somebody had to read the
 * council's email, realise it was a determination, tick "Received it" and then
 * go and find the notice. The alert is what turns that into a line on the
 * screen naming the file to go and fetch.
 */
export const PORTAL_DOWNLOAD_ALERT: Readonly<
  Partial<Record<ComplianceExternalApplicationKind, ComplianceAlertType>>
> = {
  [ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE]:
    ComplianceAlertType.CDC_DOWNLOAD_READY,
  [ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE]:
    ComplianceAlertType.CC_DOWNLOAD_READY,
  [ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION]:
    ComplianceAlertType.DA_DOWNLOAD_READY,
};

const PORTAL_DOWNLOAD_ALERTS: ReadonlySet<ComplianceAlertType> = new Set(
  Object.values(PORTAL_DOWNLOAD_ALERT).filter(
    (type): type is ComplianceAlertType => Boolean(type),
  ),
);

/**
 * Whether an alert is good news waiting to be acted on.
 *
 * Read in three places and each of them reads it to *not* do something: the
 * stage header does not redden a node over one, the overdue-document reader does
 * not count it as a document somebody is late with, and the alert row renders it
 * green rather than amber. All three are the same statement -- the portal has
 * answered, nobody is behind, there is one click left.
 */
export function isPortalDownloadAlert(type: ComplianceAlertType): boolean {
  return PORTAL_DOWNLOAD_ALERTS.has(type);
}

/**
 * Which certificate this file will close on.
 *
 * Read in the order the evidence is strong, which is the whole of the care this
 * function needs. The naive reading is "does the job have a development
 * application", and on its own that is unstable in a way that loses a document:
 * `hasDevelopmentApplication` is true while DA_APPROVAL_REQUIRED is *open*, and
 * that alert can be resolved as not applying after all. A job briefly flagged as
 * needing consent and then cleared would have its certificate kind flip from CC
 * back to CDC -- and a CONSTRUCTION_CERTIFICATE already on the row would stop
 * counting as the file's certificate, leaving a finished job reading as
 * unfinished with its certificate sitting in the vault.
 *
 * So the certificate already on the file wins, and nothing can argue with it. A
 * document is the strongest thing this file holds: whatever route anybody
 * believes the job took, the certificate that was actually issued says what it
 * was. Then the lodgement, which is a fact an admin recorded. Only then the
 * alert, which is the one reversible input -- and its reversal is *correct* at
 * that point, because a file with no certificate and no lodgement really has
 * gone back to being a CDC.
 */
export function certificateKindFor(
  engagement: CertifierEngagementDetail,
): CertificateApplicationKind {
  const held = engagement.documents.find(
    (document) =>
      isCertificateDocument(document.documentType) && document.files.length > 0,
  );
  if (held) {
    return held.documentType ===
      ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE
      ? ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE
      : ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE;
  }

  for (const kind of CERTIFICATE_APPLICATION_KINDS) {
    if (externalApplication(engagement, kind)) return kind;
  }

  return hasDevelopmentApplication(engagement)
    ? ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE
    : ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE;
}

/** The certificate document type this file will close on. */
export function certificateDocumentTypeFor(
  engagement: CertifierEngagementDetail,
): ComplianceDocumentType {
  return CERTIFICATE_DOCUMENT_TYPE[certificateKindFor(engagement)];
}

/** The certificate application row on this file, or null before it is lodged. */
export function certificateApplication(engagement: CertifierEngagementDetail) {
  return externalApplication(engagement, certificateKindFor(engagement));
}

/**
 * Whether the certifier has finished with the checklist.
 *
 * The engagement's own status rather than a walk over the rows, and that is the
 * gate rather than a proxy for it. Every row having a file means *we* have
 * finished collecting; it says nothing about whether the certifier has looked at
 * any of it. The portal application is an assertion that a registered certifier
 * is satisfied, so it is their verdict that has to be recorded -- which is what
 * the existing send-for-review loop and the per-document approvals produce, and
 * what moves the engagement to APPROVED.
 *
 * The three statuses after APPROVED count too. A file that has already lodged,
 * already holds its certificate, or is closed has obviously cleared this gate,
 * and reading APPROVED alone would have the block refuse to render its own
 * history.
 */
const CERTIFIER_FINISHED_STATUSES: ReadonlySet<CertifierEngagementStatus> =
  new Set([
    CertifierEngagementStatus.APPROVED,
    CertifierEngagementStatus.CERTIFICATE_ISSUED,
    CertifierEngagementStatus.COMPLETED,
  ]);

export function certifierHasPassedChecklist(
  engagement: CertifierEngagementDetail,
): boolean {
  return CERTIFIER_FINISHED_STATUSES.has(engagement.status);
}

/** Whether the principal certifier appointment has been recorded. */
export function hasPrincipalCertifier(
  engagement: Pick<CertifierEngagementDetail, "principalCertifierAppointedAt">,
): boolean {
  return engagement.principalCertifierAppointedAt !== null;
}

/**
 * Whether a certificate of either kind is on the file.
 *
 * Not "the right one". A file that holds a construction certificate is finished
 * whatever `certificateKindFor` would have guessed, which is the same ordering
 * that function takes and for the same reason: the document that was issued is
 * the last word on which path the job took.
 */
export function hasCertificate(
  engagement: Pick<CertifierEngagementDetail, "documents">,
): boolean {
  return engagement.documents.some(
    (document) =>
      isCertificateDocument(document.documentType) && document.files.length > 0,
  );
}

/**
 * Why the certificate application cannot be lodged yet, or null.
 *
 * The sentence rather than a boolean, in the shape `checklistBlockedReason` and
 * `packSendBlockedReason` already use, so the refusal on the button and the
 * refusal from the server are the same words -- a grey control with no
 * explanation beside it is a bug report.
 *
 * Read in the order the reader can act. The certifier's verdict first, because
 * it is the condition that takes weeks and every other one is minutes of
 * paperwork; then the consent, which only a CC waits on; then the appointment,
 * which only a CDC does -- a construction certificate follows a consent the
 * council has already granted, and the principal certifier is appointed at the
 * notice of commencement after it. Last the covenant, which is the one that
 * catches people out.
 */
export function certificateLodgementBlockedReason(
  engagement: CertifierEngagementDetail,
  developerBlocked: string | null = null,
): string | null {
  const kind = certificateKindFor(engagement);

  if (!certifierHasPassedChecklist(engagement)) {
    return "The certifier has to pass every checklist item before the application goes in. Send the pack for review and record their decision first.";
  }

  if (
    kind === ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE &&
    !hasDevelopmentConsent(engagement)
  ) {
    return "Upload the council's notice of determination before lodging the construction certificate application.";
  }

  if (
    kind ===
      ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE &&
    !hasPrincipalCertifier(engagement)
  ) {
    return "Appoint the certifier as principal certifier on the NSW Planning Portal and record it below. A CDC cannot be determined without it.";
  }

  return developerBlocked;
}

/**
 * What is left before the compliance file can close, or null.
 *
 * Everything after the lodgement, in the order it happens, so the block can say
 * one sentence about the next step rather than a list of five. Null means
 * nothing is outstanding -- which on a COMPLETED file is the first thing
 * checked, because a finished job must not be told what it still has to do.
 *
 * The determination is deliberately not one of these steps. Waiting for the
 * portal is not something anybody can act on, and a blocked reason that says
 * "wait" is noise on a screen whose whole job is to say what to do next; the
 * clock on the stage and CDC_DETERMINATION_OVERDUE are what speak to that wait.
 */
export function certificateCompletionBlockedReason(
  engagement: CertifierEngagementDetail,
  developerBlocked: string | null = null,
): string | null {
  if (engagement.status === CertifierEngagementStatus.COMPLETED) return null;

  const certificateOnFile = hasCertificate(engagement);

  if (!certificateOnFile) {
    const blocked = certificateLodgementBlockedReason(
      engagement,
      developerBlocked,
    );
    if (blocked) return blocked;

    const application = certificateApplication(engagement);
    if (!application?.appliedAt) {
      return "Lodge the application on the NSW Planning Portal and record the date below.";
    }

    return "Download the issued certificate from the NSW Planning Portal and upload it here. The portal's approval email is a notification, not the certificate.";
  }

  // Waved off counts as answered, as it does on every other row. A job whose
  // owners are covered under an existing policy is not a job to hold open.
  const cover = engagement.documents.find(
    (document) =>
      document.documentType === ComplianceDocumentType.HOME_INSURANCE,
  );
  if (!cover?.files.length && !(cover && isNotRequired(cover.status))) {
    return "Upload the HBCF certificate of insurance.";
  }

  return null;
}
