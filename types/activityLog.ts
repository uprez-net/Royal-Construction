/**
 * Activity log template registry.
 *
 * This module centralizes the application's activity logging system by:
 * - Defining all supported activity log types.
 * - Providing strongly typed payloads inferred from Zod schemas.
 * - Validating activity log payloads at runtime.
 * - Generating standardized audit log entries.
 *
 * All activity logs should be created using `createActivityLogEntry()`
 * to ensure payload validation and consistent formatting across the
 * application.
 */
import { z } from "zod";
import { activityLogSchemas } from "@/utils/validators";
import { v4 as uuidv4 } from "uuid";


/**
 * Union of every supported activity log type.
 *
 * Each activity log type corresponds to:
 * - A Zod validation schema.
 * - An activity log template.
 * - A strongly typed payload.
 */
export type ActivityLogType = keyof typeof activityLogSchemas;

/**
 * Maps each activity log type to its validated payload type.
 *
 * Payload types are automatically inferred from the corresponding Zod
 * schemas, ensuring runtime validation and compile-time type safety
 * remain synchronized.
 */
export type ActivityLogDataMap = {
    [K in ActivityLogType]: z.infer<(typeof activityLogSchemas)[K]>;
};

/**
 * Represents a fully rendered activity log entry ready to be persisted.
 *
 * Each entry records a significant action performed within the system,
 * providing a chronological audit trail for projects and milestones.
 */
export type ActivityLogEntry = {
    id: string;
    type: ActivityLogType;
    message: string;
    authorId: string;
    timestamp: string;
    projectId: string;
    milestoneId?: string;
}

/**
 * Maps every activity log type to a template factory responsible for
 * generating standardized activity log entries.
 *
 * Each factory receives a validated payload specific to its activity
 * log type and returns a complete activity log entry containing
 * metadata, timestamps and a human-readable message.
 */
type ActivityLogTemplateFactory = {
    [K in ActivityLogType]: (
        data: ActivityLogDataMap[K]
    ) => ActivityLogEntry;
};

/**
 * Collection of activity log template factories used throughout the
 * application.
 *
 * Each activity type has a corresponding template responsible for
 * transforming validated payloads into standardized audit log entries.
 *
 * Templates define:
 * - Activity type
 * - Human-readable message
 * - Author
 * - Timestamp
 * - Project and milestone references
 *
 * Keeping all templates centralized ensures activity logs remain
 * consistent regardless of where they are created.
 */
export const activityLogTemplates: ActivityLogTemplateFactory = {
    projectCreated: (data) => ({
        id: uuidv4(),
        type: "projectCreated",
        message: `Project ${data.projectName} created for ${data.customerName} in ${data.location}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    tradieScheduleCreated: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleCreated",
        message: `Tradie ${data.tradieName} scheduled for ${data.scheduleDate} for ${data.durationDays} days`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    tradieScheduleUpdated: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleUpdated",
        message: `Tradie ${data.tradieName} schedule ${data.approved ? 'approved' : 'declined'} for ${data.scheduleDate} for ${data.durationDays} days`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    tradieScheduleQuoted: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleQuoted",
        message: `Tradie ${data.tradieName} quoted a price of ${data.quote} for ${data.scheduleDate} for ${data.durationDays} days`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    tradieScheduleAvailable: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleAvailable",
        message: `Tradie ${data.tradieName} confirmed their availability for ${data.scheduleDate} for ${data.durationDays} days`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    tradieScheduleDeletionRequested: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleDeletionRequested",
        message: `Removal of ${data.tradieName}'s booking on ${data.scheduleDate} sent for admin approval: ${data.reason}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    tradieScheduleDeleted: (data) => ({
        id: uuidv4(),
        type: "tradieScheduleDeleted",
        message: `${data.tradieName}'s booking on ${data.scheduleDate} was removed after admin approval`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    variationCreated: (data) => ({
        id: uuidv4(),
        type: "variationCreated",
        message: `Variation created for project ${data.projectName} with description: ${data.variationDescription} and amount: ${data.variationAmount}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    variationUpdated: (data) => ({
        id: uuidv4(),
        type: "variationUpdated",
        message: `Variation status updated for project ${data.projectName} with description: ${data.variationDescription} to status: ${data.status}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    fileUploaded: (data) => ({
        id: uuidv4(),
        type: "fileUploaded",
        message: `File ${data.fileName} uploaded for project ${data.projectId}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    milestoneStatusChanged: (data) => ({
        id: uuidv4(),
        type: "milestoneStatusChanged",
        message: `Milestone ${data.milestoneName} status changed to ${data.newStatus}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    newMilestonePhotoUploaded: (data) => ({
        id: uuidv4(),
        type: "newMilestonePhotoUploaded",
        message: `${data.fileCount} photos uploaded for milestone ${data.milestoneName}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    milestoneAdded: (data) => ({
        id: uuidv4(),
        type: "milestoneAdded",
        message: `New Milestone ${data.milestoneName} added`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
        milestoneId: data.milestoneId,
    }),

    // --- Compliance and certification -------------------------------------
    // These are the audit trail for a process that runs largely over email,
    // where the only other record of what was sent and when lives in a mailbox
    // nobody on the project can see.

    certifierOutreachSent: (data) => ({
        id: uuidv4(),
        type: "certifierOutreachSent",
        message: `Sent ${data.documentCount} document${data.documentCount === 1 ? "" : "s"} to the certifier at ${data.certifierEmail} (${data.refToken})`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    certifierReplySent: (data) => ({
        id: uuidv4(),
        type: "certifierReplySent",
        message: data.attachmentCount > 0
            ? `Replied to the certifier at ${data.certifierEmail} with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}`
            : `Replied to the certifier at ${data.certifierEmail}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    certifierResponseReceived: (data) => ({
        id: uuidv4(),
        type: "certifierResponseReceived",
        message: `Certifier replied from ${data.emailFrom}: "${data.subject}" with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceOutreachSent: (data) => ({
        id: uuidv4(),
        type: "complianceOutreachSent",
        message: `Engaged the ${data.party.toLowerCase()} at ${data.contactEmail} with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"} (${data.refToken})`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceOutreachSelfSupplied: (data) => ({
        id: uuidv4(),
        type: "complianceOutreachSelfSupplied",
        message: `${data.recordedBy} recorded the ${data.party.toLowerCase()} documents as supplied by the client`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceOutreachResponseReceived: (data) => ({
        id: uuidv4(),
        type: "complianceOutreachResponseReceived",
        message: `The ${data.party.toLowerCase()} replied from ${data.emailFrom}: "${data.subject}" with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceAlertRaised: (data) => ({
        id: uuidv4(),
        type: "complianceAlertRaised",
        message: `Compliance alert raised by ${data.raisedBy}: ${data.alertType}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceAlertResolved: (data) => ({
        id: uuidv4(),
        type: "complianceAlertResolved",
        message: `Compliance alert ${data.alertType} resolved by ${data.resolvedBy}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceExternalApplicationUpdated: (data) => ({
        id: uuidv4(),
        type: "complianceExternalApplicationUpdated",
        message: `${data.recordedBy} updated the ${data.kind} application (${data.step})`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceChecklistMapped: (data) => ({
        id: uuidv4(),
        type: "complianceChecklistMapped",
        message: `${data.mappedCount} checklist item${data.mappedCount === 1 ? "" : "s"} answered from documents already on the file (${data.documentTypes.join(", ")})`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceWasteManagementRequested: (data) => ({
        id: uuidv4(),
        type: "complianceWasteManagementRequested",
        message: `${data.requestedBy} asked the architect for the waste management plan with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDeveloperDecision: (data) => ({
        id: uuidv4(),
        type: "complianceDeveloperDecision",
        message: `${data.estate ?? "The estate developer"} ${
            data.decision === "APPROVED" ? "approved" : "rejected"
        } the bushfire report${
            data.channel === "ADMIN"
                ? ` — recorded by ${data.decidedBy ?? "an admin"}`
                : " — read off their reply"
        }${data.reason ? `: "${data.reason}"` : ""}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceBushfireRevisionRequested: (data) => ({
        id: uuidv4(),
        type: "complianceBushfireRevisionRequested",
        message: `Sent the developer's reasons to the bushfire consultant and asked for a revised report: "${data.reason}"`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceBushfireRevisionReceived: (data) => ({
        id: uuidv4(),
        type: "complianceBushfireRevisionReceived",
        message: "A revised bushfire report came back from the consultant",
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDeveloperResent: (data) => ({
        id: uuidv4(),
        type: "complianceDeveloperResent",
        message: `${data.requestedBy ?? "An admin"} sent the bushfire report back to the developer with ${data.attachmentCount} attachment${data.attachmentCount === 1 ? "" : "s"}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDeveloperApprovalRequirementSet: (data) => ({
        id: uuidv4(),
        type: "complianceDeveloperApprovalRequirementSet",
        message: `${data.answeredBy ?? "An admin"} recorded that this lot ${
            data.required ? "needs" : "does not need"
        } the estate developer's approval on the bushfire report`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceCertificateIssued: (data) => ({
        id: uuidv4(),
        type: "complianceCertificateIssued",
        message: "The certifier issued the construction certificate",
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceCompleted: (data) => ({
        id: uuidv4(),
        type: "complianceCompleted",
        message: "Compliance complete — the construction certificate and the HBCF cover are both on the file",
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceIssuedItemsRecorded: (data) => ({
        id: uuidv4(),
        type: "complianceIssuedItemsRecorded",
        message: [
            data.requestedCount > 0
                ? `The ${data.assessor} asked for ${data.requestedCount} more document${data.requestedCount === 1 ? "" : "s"}`
                : null,
            data.rejectedCount > 0
                ? `sent back ${data.rejectedCount}`
                : null,
            data.unmatched.length > 0
                ? `and refused ${data.unmatched.join(", ")}, which could not be matched to a row on the file`
                : null,
        ]
            .filter(Boolean)
            .join(", "),
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceMeetingScheduled: (data) => ({
        id: uuidv4(),
        type: "complianceMeetingScheduled",
        message: `${data.recordedBy} ${data.isReschedule ? "rescheduled" : "scheduled"} the client and architect meeting for ${data.scheduledFor}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceMeetingHeld: (data) => ({
        id: uuidv4(),
        type: "complianceMeetingHeld",
        message: `${data.recordedBy} recorded the client and architect meeting as held on ${data.heldAt}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    compliancePlansReviewed: (data) => ({
        id: uuidv4(),
        type: "compliancePlansReviewed",
        message: data.approved
            ? `${data.recordedBy} recorded that the client approved the preliminary plans`
            : `${data.recordedBy} sent the client's revisions to the architect`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceFollowUpSent: (data) => ({
        id: uuidv4(),
        type: "complianceFollowUpSent",
        message: `${data.sentBy} chased the ${data.party.toLowerCase()} at ${data.contactEmail} about ${data.alertType}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDocumentUploaded: (data) => ({
        id: uuidv4(),
        type: "complianceDocumentUploaded",
        message: `${data.documentLabel} uploaded (${data.fileName})`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDocumentApproved: (data) => ({
        id: uuidv4(),
        type: "complianceDocumentApproved",
        message: `${data.documentLabel} approved by ${data.resolvedBy}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDocumentNotRequired: (data) => ({
        id: uuidv4(),
        type: "complianceDocumentNotRequired",
        message: data.notRequired
            ? `${data.documentLabel} marked not required by ${data.resolvedBy}`
            : `${data.documentLabel} put back as required by ${data.resolvedBy}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    complianceDocumentRejected: (data) => ({
        id: uuidv4(),
        type: "complianceDocumentRejected",
        message: `${data.documentLabel} rejected by ${data.resolvedBy}: ${data.rejectionReason}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),

    checklistExtracted: (data) => ({
        id: uuidv4(),
        type: "checklistExtracted",
        message: `Certifier checklist extracted into ${data.itemCount} tracked item${data.itemCount === 1 ? "" : "s"}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),
};

/**
 * Creates a validated activity log entry.
 *
 * The supplied payload is first validated against the Zod schema
 * associated with the activity log type. If validation succeeds,
 * the corresponding template is rendered into a complete activity
 * log entry with a generated identifier and timestamp.
 *
 * This helper provides a single, type-safe entry point for creating
 * audit log entries throughout the application.
 *
 * @template T - Activity log type.
 * @param type - Activity log type to generate.
 * @param data - Payload associated with the activity log type.
 * @returns A fully populated activity log entry ready to be persisted.
 *
 * @throws {ZodError}
 * Thrown when the supplied payload does not satisfy the schema for
 * the specified activity log type.
 */
export const createActivityLogEntry = <T extends ActivityLogType>(
    type: T,
    data: ActivityLogDataMap[T]
): ActivityLogEntry => {
    const validatedData = activityLogSchemas[type].parse(data);

    return activityLogTemplates[type](validatedData as ActivityLogDataMap[T]);
}