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

    leadFollowupDue: z.object({
        leadId: z.string(),
        customerName: z.string(),
        followupDate: z.string().optional(),
        followupTime: z.string().optional(),
    }),

    leadMeetingReview: z.object({
        leadId: z.string(),
        customerName: z.string(),
        meetingDate: z.string().optional(),
        meetingTime: z.string().optional(),
        meetingMode: z.string().optional(),
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

    tradieScheduleDeletionRequest: z.object({
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
        reason: z.string(),
        requestedBy: z.string(),
    }),

    tradieScheduleDeletionResolved: z.object({
        approvalId: z.string(),
        scheduleId: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        milestoneId: z.string().optional(),
        milestoneName: z.string().optional(),
        scheduledDate: z.string(),
        tradieId: z.string(),
        tradieName: z.string(),
        trade: z.string(),
        approved: z.boolean(),
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

    contractSigned: z.object({
        leadId: z.string(),
        offerReference: z.string(),
        customerName: z.string(),
        siteAddress: z.string(),
    }),

    /**
     * DocuSign completed an envelope the app had recalled, voided or replaced.
     * The signed copy is kept but never filed as the executed document.
     */
    unexpectedEnvelopeCompletion: z.object({
        leadId: z.string(),
        offerReference: z.string(),
        documentLabel: z.string(),
        envelopeId: z.string(),
        customerName: z.string(),
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
        projectName: z.string(),
    }),

    newMilestonePhotoUploaded: z.object({
        projectId: z.string(),
        milestoneId: z.string(),
        milestoneName: z.string(),
        fileCount: z.number(),
        projectName: z.string(),
    }),

    // --- Compliance and certification -------------------------------------
    // Only the events someone has to know about or act on. Per-document
    // approvals are deliberately absent: a checklist runs to twenty items, and
    // a notification each would bury the two that matter — a rejection, which
    // creates work, and the final approval, which ends it.

    certifierOutreachSent: z.object({
        projectId: z.string(),
        projectName: z.string(),
        certifierEmail: z.string(),
        documentCount: z.number(),
    }),

    certifierResponseReceived: z.object({
        projectId: z.string(),
        projectName: z.string(),
        engagementId: z.string(),
        attachmentCount: z.number(),
        /**
         * The received checklist document, when the reply carried one. Its
         * absence is what keeps the notification from offering to run an
         * extraction with nothing to extract.
         */
        checklistDocumentId: z.string().optional(),
    }),

    complianceOutreachSent: z.object({
        projectId: z.string(),
        projectName: z.string(),
        /** "Surveyor", "Architect" -- already in reading form. */
        party: z.string(),
        contactEmail: z.string(),
        attachmentCount: z.number(),
    }),

    complianceOutreachResponseReceived: z.object({
        projectId: z.string(),
        projectName: z.string(),
        party: z.string(),
        attachmentCount: z.number(),
    }),

    complianceAlertRaised: z.object({
        projectId: z.string(),
        projectName: z.string(),
        alertId: z.string(),
        alertTitle: z.string(),
        /** The raiser's own words, where the message carried any. */
        detail: z.string(),
    }),

    complianceChecklistExtracted: z.object({
        projectId: z.string(),
        projectName: z.string(),
        itemCount: z.number(),
    }),

    complianceDocumentRejected: z.object({
        projectId: z.string(),
        projectName: z.string(),
        documentLabel: z.string(),
        rejectionReason: z.string(),
        resolvedBy: z.string(),
    }),

    complianceReviewSent: z.object({
        projectId: z.string(),
        projectName: z.string(),
        documentCount: z.number(),
    }),

    complianceApproved: z.object({
        projectId: z.string(),
        projectName: z.string(),
    }),

    /**
     * The estate developer's answer on the bushfire report.
     *
     * One notification for both verdicts rather than two, because both are news
     * and both send the reader to the same block. What differs is only the
     * sentence, which the template builds off `decision`.
     */
    complianceDeveloperDecision: z.object({
        projectId: z.string(),
        projectName: z.string(),
        decision: z.string(),
        reason: z.string(),
        estate: z.string(),
    }),

    complianceDeveloperResent: z.object({
        projectId: z.string(),
        projectName: z.string(),
        party: z.string(),
        documentLabel: z.string(),
    }),

    /**
     * The certifier has issued the construction certificate.
     *
     * The end of the compliance file, and the one notification here that is
     * unambiguously good news — which is why it says what happens next rather
     * than only what happened.
     */
    complianceCertificateIssued: z.object({
        projectId: z.string(),
        projectName: z.string(),
    }),

    complianceCompleted: z.object({
        projectId: z.string(),
        projectName: z.string(),
    }),

    /**
     * The council has come back on the development application asking for more.
     *
     * Counted rather than listed: a portal email routinely asks for six things
     * and rejects two, and a notification that names all eight is one nobody
     * reads to the end.
     */
    complianceDaItemsRequested: z.object({
        projectId: z.string(),
        projectName: z.string(),
        requestedCount: z.number(),
        rejectedCount: z.number(),
    }),


} as const;