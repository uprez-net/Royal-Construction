// Server code only, not a Server Action: as "use server" this was an endpoint
// any signed-in browser could post an arbitrary notification through.
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { Novu } from "@novu/api";

import { instrumentApi } from "@/lib/observability/instrument";

import {
  getOfficeNotificationRecipients,
  getNotificationRecipients,
} from "../data/user";
import {
  notificationEnvironment,
  notificationSubscriberId,
  selectNotificationRecipients,
  serverNotificationOrigin,
  type NotificationRecipient,
} from "./environment";

// `triggerNotification` catches every failure and returns `{ success: false }`,
// and its callers (the reminder crons, the lead and offer flows) mostly log and
// move on, so a Novu outage or a revoked key would otherwise mean notifications
// that quietly stop arriving. The wrapper reports a failed `trigger` with the
// vendor and operation; the catch below still turns it into the same result.
const novu = instrumentApi(
  "novu",
  new Novu({ secretKey: process.env.NOVU_SECRET_KEY }),
);

const WORKFLOW_IDENTIFIER = "royal-consturction";

type NotificationResult =
  | { success: true; delivered: number }
  | { success: false; error: string };

/**
 * The signed-in person behind this request, when there is one. A cron, a
 * webhook or a workflow step has none, and `auth()` may throw outside a
 * request; either way the answer is "nobody".
 */
async function currentRequester(): Promise<NotificationRecipient | null> {
  try {
    const { userId } = await auth();
    return userId ? { clerkId: userId, email: "" } : null;
  } catch {
    return null;
  }
}

/**
 * Sends an in-app notification through Novu to one or more users.
 *
 * Recipients can be explicitly provided via user IDs or, if no recipients are
 * supplied, the notification is broadcast to the office (ADMIN and GUEST),
 * not to site managers, customers or tradies.
 *
 * Who actually receives it depends on where this runs (see
 * lib/notification/environment.ts): production skips the muted test accounts;
 * staging and local development send only to the person who made the request.
 * Each origin has its own Novu subscriber per person, so staging's
 * notifications never show in production's inbox, or the other way round.
 *
 * A send the environment rules deliberately skip is a success with nothing
 * delivered, not a failure: the reminder crons retry failures, and must not
 * retry a reminder that was never meant to go out here.
 *
 * @param userId - Array of application user IDs. Pass an empty array to send
 * the notification to the office.
 * @param content - Notification content.
 * @param content.title - Notification title.
 * @param content.message - Notification body.
 * @param content.url - URL to open when the notification is clicked.
 */
export async function triggerNotification(
  userId: Array<string | null | undefined>,
  content: {
    title: string;
    message: string;
    url: string;
  },
): Promise<NotificationResult> {
  try {
    const recipients =
      userId.length === 0
        ? await getOfficeNotificationRecipients()
        : await getNotificationRecipients(userId);
    if (recipients.length === 0) {
      return { success: false, error: "No notification recipients found" };
    }

    const environment = notificationEnvironment(process.env);
    const origin = serverNotificationOrigin(process.env);
    const selected = selectNotificationRecipients({
      environment,
      recipients,
      requester: environment === "production" ? null : await currentRequester(),
    });
    if (selected.length === 0) return { success: true, delivered: 0 };

    await novu.trigger({
      workflowId: WORKFLOW_IDENTIFIER,
      to: selected.map((recipient) => ({
        subscriberId: notificationSubscriberId(recipient.clerkId, origin),
      })),
      payload: {
        subject: content.title,
        body: content.message,
        url: content.url,
        // Where it was raised, so Novu's activity log says which deployment
        // a notification came from.
        origin,
      },
    });
    return { success: true, delivered: selected.length };
  } catch (error) {
    console.error("Error triggering notification:", error);
    return { success: false, error: "Failed to trigger notification" };
  }
}
