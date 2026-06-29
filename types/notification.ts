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
    data: NotificationDataMap[K]
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
  payload: NotificationDataMap[T]
) {
  const validatedPayload = notificationSchemas[type].parse(payload);

  return notificationTemplates[type](validatedPayload as NotificationDataMap[T]);
}