import { notificationSchemas } from "@/utils/validators/notification";
import { z } from "zod";

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
    url: `/leads?query=${data.customerName}`,
  }),

  leadUpdated: (data) => ({
    title: `Lead Updated: LED-#${data.leadId} - ${data.customerName}`,
    message: `${data.customerName}'s lead moved to ${data.status}`,
    url: `/leads?status=${data.status}`,
  }),

  leadAssigned: (data) => ({
    title: `Lead Assigned: LED-#${data.leadId} - ${data.customerName}`,
    message: `${data.customerName}'s lead assigned to ${data.assignedTo}`,
    url: `/leads?query=${data.customerName}`,
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
};

export function createNotification<T extends NotificationType>(
  type: T,
  payload: NotificationDataMap[T]
) {
  const validatedPayload = notificationSchemas[type].parse(payload);

  return notificationTemplates[type](validatedPayload as NotificationDataMap[T]);
}