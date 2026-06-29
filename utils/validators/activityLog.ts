import { VariationStatus } from "@prisma/client";
import { z } from "zod";

export const activityLogSchemas = {
    projectCreated: z.object({
        projectId: z.string(),
        projectName: z.string(),
        projectType: z.string(),
        location: z.string(),
        customerName: z.string(),
        customerEmail: z.email(),
        customerPhone: z.string(),
    }),

    tradieScheduleCreated: z.object({
        projectId: z.string(),
        scheduleId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        scheduleDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string(),
    }),

    tradieScheduleAvailable: z.object({
        projectId: z.string(),
        scheduleId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        scheduleDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string(),
    }),

    tradieScheduleUpdated: z.object({
        projectId: z.string(),
        scheduleId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        scheduleDate: z.string(),
        durationDays: z.number(),
        cost: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string(),
        approved: z.boolean(),
    }),

    tradieScheduleQuoted: z.object({
        projectId: z.string(),
        scheduleId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        scheduleDate: z.string(),
        durationDays: z.number(),
        quote: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string(),
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
        status: z.enum(VariationStatus),
    }),

    fileUploaded: z.object({
        projectId: z.string(),
        milestoneId: z.string().optional(),
        fileId: z.string(),
        fileName: z.string(),
        fileType: z.string(),
        fileSize: z.number(),
    }),
}