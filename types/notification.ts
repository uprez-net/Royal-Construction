import { notificationSchemas } from "@/utils/validators";
import { z } from "zod";
import { TradieApprovalActionType, TradieApprovalStatus } from "@prisma/client";

/**
 * Union of every supported notification type.
 *
 * Each notification type corresponds to:
 * - A Zod validation schema.
 * - A notification template.
 * - A strongly typed payload.
 */
export type NotificationType = keyof typeof notificationSchemas;

/**
 * Maps each notification type to its validated payload type.
 *
 * Payload types are automatically inferred from the corresponding Zod
 * schemas, ensuring that notifications remain type-safe and validation
 * stays synchronized with the runtime schemas.
 */
export type NotificationDataMap = {
  [K in NotificationType]: z.infer<(typeof notificationSchemas)[K]>;
};

/**
 * Represents a fully rendered notification ready to be dispatched.
 *
 * The URL should point users directly to the relevant page within the
 * application when the notification is opened.
 */
type NotificationTemplate = {
  title: string;
  message: string;
  url: string;
};

/**
 * Maps every notification type to a template factory responsible for
 * generating the notification title, message and destination URL.
 *
 * Each factory receives a validated payload specific to its notification
 * type and returns a fully formatted notification template.
 */
type NotificationTemplateFactory = {
  [K in NotificationType]: (
    data: NotificationDataMap[K],
  ) => NotificationTemplate;
};

/**
 * Collection of notification template factories used throughout the
 * application.
 *
 * Each notification type has a corresponding template responsible for
 * transforming validated notification payloads into user-facing content.
 *
 * Templates define:
 * - Notification title
 * - Notification message
 * - Deep link into the application
 *
 * All notification content should be centralized here to ensure
 * consistency across every delivery channel (in-app, email, push, etc.).
 */
export const notificationTemplates: NotificationTemplateFactory = {
  leadCreated: (data) => ({
    title: `New Lead: LED-#${data.leadId} - ${data.customerName}`,
    message: `Lead created for build type ${data.leadType} in ${data.location}`,
    url: `/leads?query=${encodeURIComponent(data.customerName)}`,
  }),

  leadUpdated: (data) => ({
    title: `Lead Updated: LED-#${data.leadId} - ${data.customerName}`,
    message: `${data.customerName}'s lead ${data.change ?? `moved to ${data.status}`}`,
    url: `/leads?status=${encodeURIComponent(data.status)}`,
  }),

  leadAssigned: (data) => ({
    title: `Lead Assigned: LED-#${data.leadId} - ${data.customerName}`,
    message: `${data.customerName}'s lead assigned to ${data.assignedTo}`,
    url: `/leads?query=${encodeURIComponent(data.customerName)}`,
  }),

  leadFollowupDue: (data) => ({
    title: `Follow-up Due: LED-#${data.leadId} - ${data.customerName}`,
    message: `Follow-up is due for ${data.customerName}`,
    url: `/leads?leadId=${data.leadId}&action=followup`,
  }),

  leadMeetingReview: (data) => ({
    title: `Meeting Review: LED-#${data.leadId} - ${data.customerName}`,
    message: `Review the meeting outcome for ${data.customerName}`,
    url: `/leads?leadId=${data.leadId}&action=meetingReview`,
  }),

  projectCreated: (data) => ({
    title: `Project Created: ${data.projectName}`,
    message: `${data.projectName} has been created`,
    url: `/projects/${data.projectId}`,
  }),

  projectSiteUpdates: (data) => ({
    title: `Site Update: ${data.projectName}`,
    message: `${data.milestoneName}: ${data.updateNote}`,
    url: `/projects/${data.projectId}?activeTab=updates`,
  }),

  tradieScheduleCreated: (data) => ({
    title: `Tradie Scheduled: ${data.projectName}`,
    message: `${data.tradieName} scheduled for ${data.projectName}`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  tradieScheduleUpdated: (data) => ({
    title: `Tradie Schedule Updated: ${data.projectName}`,
    message: `${data.tradieName}'s schedule is now ${data.status}`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  variationCreated: (data) => ({
    title: `Variation Created: ${data.projectName} for ${data.variationAmount}`,
    message: `A new variation has been created asking for ${data.variationDescription}`,
    url: `/projects/${data.projectId}?activeTab=variations`,
  }),

  variationUpdated: (data) => ({
    title: `Variation Updated: ${data.projectName}`,
    message: `A variation has been updated with status ${data.status}`,
    url: `/projects/${data.projectId}?activeTab=variations`,
  }),

  offerCreated: (data) => ({
    title: `Offer Created: OFR-#${data.offerId} for Lead LED-#${data.leadId}`,
    message: `An offer has been created with amount ${data.offerAmount} and status ${data.offerStatus}`,
    url: `/offers/${data.leadId}`,
  }),

  offerGenerationFailed: (data) => ({
    title: `Offer Generation Failed: for Lead LED-#${data.leadId}`,
    message: `Failed to generate offer: ${data.errorMessage}`,
    url: `/offers/${data.leadId}`,
  }),

  deleteTradieApproval: (data) => ({
    title: `Approval for removing tradie: ${data.tradieName} ${data.trade}`,
    message: `A request to delete ${data.tradieName} (${data.trade}) has been sent for approval`,
    url: `/admin-approvals?q=${encodeURIComponent(data.tradieName)}&approvalType=${TradieApprovalActionType.TRADIE_REMOVAL}&status=${TradieApprovalStatus.PENDING}&approvalId=${data.approvalId}`,
  }),

  tradieIncidentReport: (data) => ({
    title: `Incident Report: ${data.tradieName} ${data.trade}`,
    message: `An incident report has been submitted for ${data.tradieName} (${data.trade})`,
    url: `/admin-approvals?q=${encodeURIComponent(data.tradieName)}&approvalType=${TradieApprovalActionType.INCIDENT_RESOLUTION}&status=${TradieApprovalStatus.PENDING}&approvalId=${data.approvalId}`,
  }),

  tradiePriceUpdate: (data) => ({
    title: `Price Update: ${data.tradieName} ${data.trade}`,
    message: `The price for ${data.tradieName} (${data.trade}) has been updated`,
    url: `/admin-approvals?q=${encodeURIComponent(data.tradieName)}&approvalType=${TradieApprovalActionType.PRICE_CHANGE}&status=${TradieApprovalStatus.PENDING}&approvalId=${data.approvalId}`,
  }),

  tradieScheduleApproval: (data) => ({
    title: `Schedule Approval Request: ${data.tradieName} (${data.trade}) for ${data.projectName}`,
    message: `A schedule approval request has been submitted for ${data.tradieName} (${data.trade}) for project ${data.projectName} on ${data.scheduledDate}`,
    url: `/admin-approvals?q=${encodeURIComponent(data.tradieName)}&approvalType=${TradieApprovalActionType.SCHEDULE_APPROVAL}&status=${TradieApprovalStatus.PENDING}&approvalId=${data.approvalId}`,
  }),

  tradieScheduleDeletionRequest: (data) => ({
    title: `Schedule Deletion Request: ${data.tradieName} (${data.trade}) for ${data.projectName}`,
    message: `${data.requestedBy} has requested the removal of ${data.tradieName}'s booking on ${data.scheduledDate} for ${data.projectName}: ${data.reason}`,
    url: `/admin-approvals?q=${encodeURIComponent(data.tradieName)}&approvalType=${TradieApprovalActionType.SCHEDULE_DELETION}&status=${TradieApprovalStatus.PENDING}&approvalId=${data.approvalId}`,
  }),

  tradieScheduleDeletionResolved: (data) => ({
    title: `Schedule Deletion ${data.approved ? "Approved" : "Rejected"}: ${data.tradieName} (${data.trade})`,
    message: data.approved
      ? `${data.tradieName}'s booking on ${data.scheduledDate} for ${data.projectName} has been removed`
      : `The request to remove ${data.tradieName}'s booking on ${data.scheduledDate} for ${data.projectName} was rejected — the booking stands`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  tradieScheduleApproved: (data) => ({
    title: `Schedule Approved: ${data.tradieName} (${data.trade}) for ${data.projectName}`,
    message: `The schedule for ${data.tradieName} (${data.trade}) for project ${data.projectName} on ${data.scheduledDate} has been approved`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  tradieScheduleRejected: (data) => ({
    title: `Schedule Rejected: ${data.tradieName} (${data.trade}) for ${data.projectName}`,
    message: `The schedule for ${data.tradieName} (${data.trade}) for project ${data.projectName} on ${data.scheduledDate} has been rejected`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  contractSigned: (data) => ({
    title: `Contract Signed: ${data.offerReference} — ${data.customerName}`,
    message: `The building contract for ${data.siteAddress || "the project site"} is fully executed. Open the offer workspace to create the project.`,
    url: `/offers/${data.leadId}`,
  }),

  unexpectedEnvelopeCompletion: (data) => ({
    title: `Unexpected Signature: ${data.offerReference} — ${data.documentLabel}`,
    message: `DocuSign reports ${data.customerName}'s ${data.documentLabel} envelope ${data.envelopeId} as signed, but the app had recalled or replaced it. The offer was not changed and the signed copy was filed separately. Check with the customer before going further.`,
    url: `/offers/${data.leadId}`,
  }),

  milestoneStatusChanged: (data) => ({
    title: `Milestone Status Changed: ${data.milestoneName}`,
    message: `The status of milestone ${data.milestoneName} has been changed to ${data.newStatus}`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  milestoneAdded: (data) => ({
    title: `Milestone Added: ${data.milestoneName}`,
    message: `New Milestone ${data.milestoneName} added to project ${data.projectName}`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  newMilestonePhotoUploaded: (data) => ({
    title: `New Photos Uploaded for Milestone: ${data.milestoneName}`,
    message: `${data.fileCount} photos uploaded for milestone ${data.milestoneName} in project ${data.projectName}`,
    url: `/projects/${data.projectId}?activeTab=milestones`,
  }),

  // --- Compliance and certification ---------------------------------------

  certifierOutreachSent: (data) => ({
    title: `Documents Sent to Certifier: ${data.projectName}`,
    message: `${data.documentCount} document${data.documentCount === 1 ? "" : "s"} sent to ${data.certifierEmail}. The next move is theirs.`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  certifierResponseReceived: (data) => ({
    title: `Certifier Replied: ${data.projectName}`,
    message: data.checklistDocumentId
      ? `${data.attachmentCount} document${data.attachmentCount === 1 ? "" : "s"} received, including a checklist ready to extract`
      : `${data.attachmentCount} document${data.attachmentCount === 1 ? "" : "s"} received from the certifier`,
    // The extraction popup is only offered when there is actually a checklist
    // to run it against; every id it needs rides the query string, because
    // triggerNotification carries no structured payload of its own.
    url: data.checklistDocumentId
      ? `/projects/${data.projectId}?activeTab=compliance&action=certifierExtract&engagementId=${data.engagementId}&documentId=${data.checklistDocumentId}`
      : `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceOutreachSent: (data) => ({
    title: `${data.party} Engaged: ${data.projectName}`,
    message: `Sent to ${data.contactEmail} with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}. The next move is theirs.`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceOutreachResponseReceived: (data) => ({
    title: `${data.party} Replied: ${data.projectName}`,
    message: `${data.attachmentCount} document${data.attachmentCount === 1 ? "" : "s"} received from the ${data.party.toLowerCase()}`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceAlertRaised: (data) => ({
    title: `Compliance Alert: ${data.projectName}`,
    // The detail is the raiser's own sentence, which is the whole value of the
    // notification: "this needs a DA" is actionable, "an alert was raised" is
    // only a reason to go and look.
    message: data.detail
      ? `${data.alertTitle}. ${data.detail}`
      : data.alertTitle,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceChecklistExtracted: (data) => ({
    title: `Checklist Ready: ${data.projectName}`,
    message: `The certifier's checklist came to ${data.itemCount} item${data.itemCount === 1 ? "" : "s"}, each now waiting on a document`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceDocumentRejected: (data) => ({
    title: `Document Sent Back: ${data.projectName}`,
    message: `${data.resolvedBy} rejected ${data.documentLabel}: ${data.rejectionReason}`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceReviewSent: (data) => ({
    title: `Compliance File Sent for Review: ${data.projectName}`,
    message: `${data.documentCount} document${data.documentCount === 1 ? "" : "s"} are with the certifier for review`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceApproved: (data) => ({
    title: `Compliance Approved: ${data.projectName}`,
    message: `Every compliance document has been approved. The section is now closed.`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceDeveloperDecision: (data) => ({
    title:
      data.decision === "APPROVED"
        ? `Developer Approved: ${data.projectName}`
        : `Developer Rejected: ${data.projectName}`,
    message:
      data.decision === "APPROVED"
        ? `${data.estate || "The estate developer"} approved the bushfire report`
        : // The reasons, in the notification itself. They are what the
          // consultant has already been sent, and somebody reading this on a
          // phone wants to know whether it is a wording change or a redesign.
          `${data.estate || "The estate developer"} rejected the bushfire report: ${data.reason}`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceDeveloperResent: (data) => ({
    title: `Sent Back to the Developer: ${data.projectName}`,
    message: `The revised ${data.documentLabel.toLowerCase()} has gone back to the ${data.party.toLowerCase()} for approval`,
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceCertificateIssued: (data) => ({
    title: `Construction Certificate Issued: ${data.projectName}`,
    message:
      "The certifier has issued the construction certificate. Upload the HBCF certificate to finish the compliance file.",
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceCompleted: (data) => ({
    title: `Compliance Complete: ${data.projectName}`,
    message:
      "The construction certificate and the HBCF cover are both on the file. The build can start.",
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),

  complianceDaItemsRequested: (data) => ({
    title: `Council Came Back: ${data.projectName}`,
    message:
      [
        data.requestedCount > 0
          ? `${data.requestedCount} more document${data.requestedCount === 1 ? "" : "s"} requested`
          : null,
        data.rejectedCount > 0 ? `${data.rejectedCount} sent back` : null,
      ]
        .filter(Boolean)
        .join(", ") ||
      "The council has come back on the development application",
    url: `/projects/${data.projectId}?activeTab=compliance`,
  }),
};

/**
 * Creates a validated notification payload for delivery.
 *
 * The supplied payload is first validated against the Zod schema associated
 * with the notification type. If validation succeeds, the corresponding
 * notification template is rendered and returned.
 *
 * This helper provides a single, type-safe entry point for generating
 * notifications throughout the application.
 *
 * @template T - Notification type.
 * @param type - Notification type to generate.
 * @param payload - Payload associated with the notification type.
 * @returns A fully rendered notification containing a title, message and URL.
 *
 * @throws {ZodError}
 * Thrown when the supplied payload does not satisfy the schema for the
 * specified notification type.
 */
export function createNotification<T extends NotificationType>(
  type: T,
  payload: NotificationDataMap[T],
) {
  const validatedPayload = notificationSchemas[type].parse(payload);

  return notificationTemplates[type](
    validatedPayload as NotificationDataMap[T],
  );
}
