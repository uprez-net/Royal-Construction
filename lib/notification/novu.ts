"use server";
import { Novu } from "@novu/api";
import { getAllUserClerkIds, resolveUserIdsToClerkIds } from "../data/user";

const novu = new Novu({ secretKey: process.env.NOVU_SECRET_KEY });

const WORKFLOW_IDENTIFIER = "royal-consturction";

type NotificationResult = { success: true } | { success: false; error: string };

export async function triggerNotification(
    userId: Array<string | null | undefined>,
    content: {
        title: string,
        message: string,
        url: string
    }
): Promise<NotificationResult> {
    try {
        let users: string[] = [];
        if(userId.length === 0) {
            users = await getAllUserClerkIds();
        } else {
            users = await resolveUserIdsToClerkIds(userId);
        }
        if (users.length === 0) {
            return { success: false, error: "No notification recipients found" };
        }
        await novu.trigger({
            workflowId: WORKFLOW_IDENTIFIER,
            to: users.map((id) => ({ subscriberId: id })),
            payload: {
                subject: content.title,
                body: content.message,
                url: content.url
            }
        })
        return { success: true };
    } catch (error) {
        console.error("Error triggering notification:", error);
        return { success: false, error: "Failed to trigger notification" };
    }
}
