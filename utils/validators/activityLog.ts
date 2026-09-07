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

    tradieScheduleDeletionRequested: z.object({
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
        reason: z.string(),
    }),

    tradieScheduleDeleted: z.object({
        projectId: z.string(),
        scheduleId: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        scheduleDate: z.string(),
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

    milestoneStatusChanged: z.object({
        projectId: z.string(),
        milestoneId: z.string(),
        milestoneName: z.string(),
        oldStatus: z.string(),
        newStatus: z.string(),
    }),

    milestoneAdded: z.object({
        projectId: z.string(),
        milestoneId: z.string(),
        milestoneName: z.string(),
    }),


    newMilestonePhotoUploaded: z.object({
        projectId: z.string(),
        milestoneId: z.string(),
        milestoneName: z.string(),
        fileCount: z.number(),
    }),

    // --- Compliance and certification -------------------------------------
    // Every payload carries projectId because ActivityLog.projectId is
    // non-null; the engagement is reached through the project, never the other
    // way round. The actor is named in the payload rather than in authorId,
    // which logAction does not persist.

    certifierOutreachSent: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        certifierEmail: z.string(),
        refToken: z.string(),
        documentCount: z.number(),
    }),

    certifierReplySent: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        certifierEmail: z.string(),
        attachmentCount: z.number(),
    }),

    certifierResponseReceived: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        emailFrom: z.string(),
        subject: z.string(),
        attachmentCount: z.number(),
    }),

    // --- Other parties on the compliance file -----------------------------
    // Same shape as the certifier entries above, plus the party, because the
    // one thing a reader of this trail needs that the certifier entries never
    // had to say is which of three concurrent threads a line is about.

    complianceOutreachSent: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        party: z.string(),
        contactEmail: z.string(),
        refToken: z.string(),
        attachmentCount: z.number(),
    }),

    complianceOutreachSelfSupplied: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        party: z.string(),
        recordedBy: z.string(),
    }),

    complianceOutreachResponseReceived: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        party: z.string(),
        emailFrom: z.string(),
        subject: z.string(),
        attachmentCount: z.number(),
    }),

    complianceAlertRaised: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        alertId: z.string(),
        alertType: z.string(),
        raisedBy: z.string(),
    }),

    complianceAlertResolved: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        alertId: z.string(),
        alertType: z.string(),
        resolvedBy: z.string(),
    }),

    complianceDocumentUploaded: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        documentId: z.string(),
        documentLabel: z.string(),
        fileName: z.string(),
    }),

    complianceDocumentApproved: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        documentId: z.string(),
        documentLabel: z.string(),
        resolvedBy: z.string(),
    }),

    complianceDocumentNotRequired: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        documentId: z.string(),
        documentLabel: z.string(),
        resolvedBy: z.string(),
        notRequired: z.boolean(),
    }),

    complianceDocumentRejected: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        documentId: z.string(),
        documentLabel: z.string(),
        resolvedBy: z.string(),
        rejectionReason: z.string(),
    }),

    checklistExtracted: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        itemCount: z.number(),
    }),
}