import { ComplianceAlertType, CompliancePartyType } from "@prisma/client";

/**
 * Which party each alert is chased with, or null where none can be.
 *
 * A plain module because both ends need it and neither can import the other.
 * The tab decides whether to offer the chase button; the data layer decides
 * which thread to send it down and refuses when there is nobody there. A button
 * that offers a chase the server then refuses is the same bug read from two
 * ends, which is exactly what a second copy of this table would produce.
 *
 * Null is a decision rather than an omission, in both cases:
 *
 * - The planning portal is a website, not a correspondent. A delayed
 *   certificate is chased by ringing the council with the application number
 *   the council block shows.
 * - A development application is a decision about the whole job, not a document
 *   somebody can be reminded about in one line.
 */
export const COMPLIANCE_ALERT_PARTY: Readonly<
  Record<ComplianceAlertType, CompliancePartyType | null>
> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]: CompliancePartyType.SURVEYOR,
  [ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE]: CompliancePartyType.SURVEYOR,
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]: CompliancePartyType.ARCHITECT,
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]:
    CompliancePartyType.ARCHITECT,
  [ComplianceAlertType.BASIX_RESPONSE_OVERDUE]:
    CompliancePartyType.BASIX_CONSULTANT,
  [ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE]:
    CompliancePartyType.BUSHFIRE_CONSULTANT,
  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: null,
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: null,
};
