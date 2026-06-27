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
        change: z.string().optional(),
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
        scheduleDate: z.string(),
    }),

    tradieScheduleUpdated: z.object({
        projectId: z.string(),
        projectName: z.string(),
        milestoneName: z.string(),
        tradieName: z.string(),
        tradieTrade: z.string(),
        scheduleDate: z.string(),
        status: z.string(),
    }),

    variationCreated: z.object({
        projectId: z.string(),
        projectName: z.string(),
        variationDescription: z.string(),
        variationAmount: z.string(),
    }),

    variationUpdated: z.object({
        projectId: z.string(),
        projectName: z.string(),
        variationDescription: z.string(),
        variationAmount: z.string(),
        status: z.string(),
    }),

    offerCreated: z.object({
        offerId: z.string(),
        leadId: z.string(),
        offerAmount: z.string(),
        offerStatus: z.string(),
    }),

    offerGenerationFailed: z.object({
        leadId: z.string(),
        errorMessage: z.string(),
    }),

    deleteTradieApproval: z.object({
        approvalId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        tradieEmail: z.email(),
        tradiePhone: z.string(),
        requestedBy: z.string(),
    }),

    tradieIncidentReport: z.object({
        approvalId: z.string(),
        incidentId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        incidentDescription: z.string(),
        incidentDate: z.string(),
    }),

    tradiePriceUpdate: z.object({
        approvalId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        oldPrice: z.number(),
        newPrice: z.number(),
        priceChangeDate: z.string(),
    }),

    tradieScheduleApproval: z.object({
        approvalId: z.string(),
        scheduleId: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string().optional(),
        scheduledDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
    }),

    tradieScheduleApproved: z.object({
        approvalId: z.string(),
        scheduleId: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string().optional(),
        scheduledDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
    }),

    tradieScheduleRejected: z.object({
        approvalId: z.string(),
        scheduleId: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string().optional(),
        scheduledDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
    }),

} as const;