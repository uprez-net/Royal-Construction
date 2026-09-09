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

    /**
     * Every step of every application to an outside body, under one entry.
     *
     * `kind` and `step` rather than an entry type per application per state:
     * the trail is read as a story about one document, and fifteen kinds of
     * line for five rows' three states makes it harder to follow rather than
     * easier.
     */
    complianceExternalApplicationUpdated: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        kind: z.string(),
        step: z.string(),
        recordedBy: z.string(),
    }),

    /**
     * A consultant, or a portal, satisfying a checklist line from what the file
     * already held.
     *
     * Logged because it is the one thing on this tab that happens without
     * anybody clicking anything. An admin who opens the checklist and finds six
     * lines already answered is owed a record of what did that and where each
     * document came from — otherwise the only honest response to "why is item 4
     * ticked" is to go and read the code.
     */
    complianceChecklistMapped: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        mappedCount: z.number(),
        documentTypes: z.array(z.string()),
    }),

    /**
     * The architect being asked for the waste management plan.
     *
     * Its own entry rather than a party outreach, because nobody is engaged:
     * the request goes on a thread that has been open since the plans were
     * commissioned, and reading it as a new engagement would put a second
     * architect on the file.
     */
    complianceWasteManagementRequested: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        contactEmail: z.string(),
        attachmentCount: z.number(),
        requestedBy: z.string(),
    }),

    complianceMeetingScheduled: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        meetingId: z.string(),
        scheduledFor: z.string(),
        /** Whether this replaced a meeting that had to move. */
        isReschedule: z.boolean(),
        recordedBy: z.string(),
    }),

    complianceMeetingHeld: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        meetingId: z.string(),
        heldAt: z.string(),
        recordedBy: z.string(),
    }),

    /**
     * The client's verdict on the preliminary plans, either way.
     *
     * One entry rather than two, because approval and a revision request are
     * the same decision with two outcomes and the trail should read as one
     * sequence of them. `feedback` is present only on a rejection.
     */
    compliancePlansReviewed: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        outreachId: z.string(),
        approved: z.boolean(),
        feedback: z.string().optional(),
        recordedBy: z.string(),
    }),

    complianceFollowUpSent: z.object({
        projectId: z.string(),
        engagementId: z.string(),
        alertId: z.string(),
        alertType: z.string(),
        party: z.string(),
        contactEmail: z.string(),
        sentBy: z.string(),
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