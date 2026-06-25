import { notificationSchemas } from "@/utils/validators";
import { z } from "zod";
import { TradieApprovalActionType, TradieApprovalStatus } from "@prisma/client";

export type NotificationType = keyof typeof notificationSchemas;

export type NotificationDataMap = {
  [K in NotificationType]: z.infer<(typeof notificationSchemas)[K]>;
};

type NotificationTemplate = {
  title: string;
  message: string;
  url: string;
};

type NotificationTemplateFactory = {
  [K in NotificationType]: (
    data: NotificationDataMap[K]
  ) => NotificationTemplate;
};

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
};

export function createNotification<T extends NotificationType>(
  type: T,
  payload: NotificationDataMap[T]
) {
  const validatedPayload = notificationSchemas[type].parse(payload);

  return notificationTemplates[type](validatedPayload as NotificationDataMap[T]);
}