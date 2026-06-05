"use server";
import { Novu } from "@novu/api";
import { getAllUserClerkIds } from "../data/user";

const novu = new Novu({ secretKey: process.env.NOVU_SECRET_KEY });

const WORKFLOW_IDENTIFIER = "royal-consturction";

export async function triggerNotification(
    content: {
        title: string,
        message: string,
        url: string
    }
) {
    const allUsers = await getAllUserClerkIds();
    try {
        await novu.trigger({
            workflowId: WORKFLOW_IDENTIFIER,
            to: allUsers.map((id) => ({ subscriberId: id })),
            payload: {
                subject: content.title,
                body: content.message,
                url: content.url
            }
        })
    } catch (error) {
        console.error("Error triggering notification:", error);
        throw error;
    }
}