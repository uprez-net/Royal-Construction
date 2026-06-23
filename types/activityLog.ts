import { z } from "zod";
import { activityLogSchemas } from "@/utils/validators";
import { v4 as uuidv4 } from "uuid";

export type ActivityLogType = keyof typeof activityLogSchemas;

export type ActivityLogDataMap = {
    [K in ActivityLogType]: z.infer<(typeof activityLogSchemas)[K]>;
};

export type ActivityLogEntry = {
    id: string;
    type: ActivityLogType;
    message: string;
    authorId: string;
    timestamp: string;
    projectId: string;
    milestoneId?: string;
}

type ActivityLogTemplateFactory = {
    [K in ActivityLogType]: (
        data: ActivityLogDataMap[K]
    ) => ActivityLogEntry;
};

export const activityLogTemplates: ActivityLogTemplateFactory = {
    projectCreated: (data) => ({
        id: uuidv4(),
        type: "projectCreated",
        message: `Project ${data.projectName} created for ${data.customerName} in ${data.location}`,
        authorId: "system",
        timestamp: new Date().toISOString(),
        projectId: data.projectId,
    }),
};

export const createActivityLogEntry = <T extends ActivityLogType>(
    type: T,
    data: ActivityLogDataMap[T]
): ActivityLogEntry => {
    const validatedData = activityLogSchemas[type].parse(data);

    return activityLogTemplates[type](validatedData as ActivityLogDataMap[T]);
}