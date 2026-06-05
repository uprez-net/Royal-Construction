import { z } from "zod";

export const notificationSchemas = {
  leadCreated: z.object({
    leadId: z.string(),
    leadType: z.string(),
    budget: z.number(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string(),
  }),

  leadUpdated: z.object({
    leadId: z.string(),
    leadType: z.string(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string(),
    status: z.string(),
  }),

  leadDeleted: z.object({
    leadId: z.string(),
    leadType: z.string(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string(),
    status: z.string(),
  }),

  leadAssigned: z.object({
    leadId: z.string(),
    leadType: z.string(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string(),
    assignedTo: z.string(),
  }),

  projectCreated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    projectType: z.string(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string(),
  }),

  projectSiteUpdates: z.object({
    projectId: z.string(),
    projectName: z.string(),
    milestoneName: z.string(),
    updateNote: z.string(),
  }),

  tradieScheduleCreated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    milestoneName: z.string(),
    tradieName: z.string(),
    tradieTrade: z.string(),
    tradieCompany: z.string(),
    scheduleDate: z.date(),
  }),

  tradieScheduleUpdated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    milestoneName: z.string(),
    tradieName: z.string(),
    tradieTrade: z.string(),
    tradieCompany: z.string(),
    scheduleDate: z.date(),
    status: z.string(),
  }),
} as const;