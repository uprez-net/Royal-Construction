import { ComplianceDocumentType } from "@prisma/client";

// Compliance done before the job came into the CRM: the two facts the
// Compliance tab, the overdue sweep, the route's validator and the commands in
// `prior-compliance.ts` all need. Nothing heavier is imported here, so a
// client component can read it.

/** What may be uploaded as compliance done elsewhere. */
export const PRIOR_COMPLIANCE_DOCUMENT_TYPES = [
  ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
  ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
  ComplianceDocumentType.HOME_INSURANCE,
  ComplianceDocumentType.DEVELOPMENT_CONSENT,
  ComplianceDocumentType.BASIX_CERTIFICATE,
] as const satisfies readonly ComplianceDocumentType[];

export type PriorComplianceDocumentType =
  (typeof PRIOR_COMPLIANCE_DOCUMENT_TYPES)[number];

/**
 * Whether a compliance file records compliance done before the CRM
 * (`openPriorComplianceFile`), rather than a certifier engaged from it.
 *
 * Every file opened through Connect with Certifier carries the certifier's
 * email — `startComplianceEngagement` requires it, and nothing clears it — so
 * a file without one can only have been recorded as done elsewhere.
 */
export function isRecordedOutsideCrm(
  engagement: { readonly certifierEmail: string | null } | null | undefined,
): boolean {
  return engagement != null && engagement.certifierEmail === null;
}
