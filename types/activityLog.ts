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