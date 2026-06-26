"use server";
import { Novu } from "@novu/api";
import { getAllUserClerkIds, resolveUserIdsToClerkIds } from "../data/user";

const novu = new Novu({ secretKey: process.env.NOVU_SECRET_KEY });

const WORKFLOW_IDENTIFIER = "royal-consturction";

type NotificationResult = { success: true } | { success: false; error: string };

/**
 * Sends an in-app notification through Novu to one or more users.
 *
 * Recipients can be explicitly provided via user IDs or, if no recipients are
 * supplied, the notification is broadcast to all users in the system.
 *
 * User IDs are resolved to their corresponding Clerk subscriber IDs before
 * dispatching the notification through the configured Novu workflow.
 *
 * If no valid recipients can be resolved, the notification is not sent and a
 * failure result is returned.
 *
 * @param userId - Array of application user IDs. Pass an empty array to send
 * the notification to all users.
 * @param content - Notification content.
 * @param content.title - Notification title.
 * @param content.message - Notification body.
 * @param content.url - URL to open when the notification is clicked.
 *
 * @returns A result object indicating whether the notification was sent
 * successfully. On failure, an error message describing the reason is returned.
 */
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
