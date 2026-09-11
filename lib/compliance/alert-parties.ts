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
  [ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE]:
    CompliancePartyType.STRUCTURAL_ENGINEER,
  [ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE]:
    CompliancePartyType.WATER_AUTHORITY,
  [ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE]:
    CompliancePartyType.TRAFFIC_CONSULTANT,
  // The one alert whose party is not the party it is about. Nobody new is
  // engaged for a waste management plan: it is drawn by the architect who did
  // the design, on the thread they already have, so the chase goes there.
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]:
    CompliancePartyType.ARCHITECT,

  // Two alerts about one report, chased on two different threads. The
  // developer is chased on theirs; the consultant re-issuing what that
  // developer rejected is chased on theirs. Sending either follow-up to the
  // other party is a fortnight lost on a job that was already late, which is
  // the whole reason these are separate types.
  [ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE]:
    CompliancePartyType.DEVELOPER,
  [ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE]:
    CompliancePartyType.BUSHFIRE_CONSULTANT,
  // The same developer, the other document. One thread, two waits, and the
  // chase is the same mail down the same thread -- which is why this is the one
  // new party entry rather than a new party.
  [ComplianceAlertType.DEVELOPER_PLANS_OVERDUE]: CompliancePartyType.DEVELOPER,

  // Nothing to chase. Every one of these is a website or a decision about the
  // whole job rather than a correspondent -- the road opening permit is chased
  // by ringing the council with the application number the block shows, and a
  // development application is not something anybody can be reminded about in
  // one line.
  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: null,
  [ComplianceAlertType.ROAD_OPENING_DELAYED]: null,
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]: null,
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]: null,
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]: null,
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: null,

  // The two certificate determinations, and the one case where null is a
  // limitation rather than a decision. Unlike a council, the body determining
  // these *is* a correspondent: the registered certifier this file has been
  // writing to for weeks, who has a live thread on it. But a certifier is not a
  // CompliancePartyType -- their thread hangs off the engagement itself, with no
  // outreach row -- and `sendComplianceFollowUp` resolves a thread by party. So
  // the chase is a sentence in the guidance naming them rather than a button,
  // which is honest: a button that resolves to no outreach can only fail.
  [ComplianceAlertType.CDC_DETERMINATION_OVERDUE]: null,
  [ComplianceAlertType.CC_DETERMINATION_OVERDUE]: null,

  // Nobody to chase because there is nothing to chase. The portal has already
  // answered; what is left is one download by whoever is reading the alert.
  [ComplianceAlertType.CDC_DOWNLOAD_READY]: null,
  [ComplianceAlertType.CC_DOWNLOAD_READY]: null,
  [ComplianceAlertType.DA_DOWNLOAD_READY]: null,
};
