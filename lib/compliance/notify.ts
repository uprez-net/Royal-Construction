import { getAllAdminUsersIds } from "@/lib/data/user";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import {
  createNotification,
  type NotificationDataMap,
  type NotificationType,
} from "@/types/notification";

/**
 * Who hears about a compliance event, and the project's name for the message.
 *
 * Site manager plus every admin, matching what the milestone writes in
 * lib/data/milestones.ts do. The site manager is the person chasing the
 * documents; the admins are the only ones who can approve or reject one.
 */
async function complianceAudience(projectId: string): Promise<{
  recipients: string[];
  projectName: string;
}> {
  const [project, admins] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, siteManagerId: true },
    }),
    getAllAdminUsersIds(),
  ]);

  const recipients = project?.siteManagerId
    ? [project.siteManagerId, ...admins]
    : admins;

  return {
    // Deduplicated: a site manager who is also an admin would otherwise be
    // sent the same notification twice.
    recipients: [...new Set(recipients)],
    projectName: project?.name ?? "Unknown Project",
  };
}

/**
 * Sends one compliance notification.
 *
 * Every caller needs the same three things — the project's name for the
 * message, the site manager and admins for the audience, and a guard against
 * an empty recipient list — so they are done once here rather than six times
 * over.
 *
 * The guard is the important part: `triggerNotification` treats an empty array
 * as "broadcast to every user in the system", so a project with no site manager
 * on an instance with no admin would tell the whole company about one rejected
 * document. The same footgun is called out in lib/data/tradie-approvals.ts.
 *
 * Never throws. A notification is a courtesy on top of a write that has already
 * happened; failing the caller because Novu is down would undo real work to
 * report a missed toast.
 *
 * @param type - The notification type, which fixes the payload's shape.
 * @param projectId - Project the event belongs to; resolves both audience and name.
 * @param payload - Everything the template needs except `projectId`/`projectName`,
 * which are filled in here.
 */
export async function notifyCompliance<
  T extends NotificationType & keyof ComplianceNotificationPayloads,
>(
  type: T,
  projectId: string,
  payload: Omit<NotificationDataMap[T], "projectId" | "projectName">,
): Promise<void> {
  try {
    const { recipients, projectName } = await complianceAudience(projectId);

    if (recipients.length === 0) {
      console.warn(
        `  No recipients for compliance notification "${type}" on project ${projectId}.`,
      );
      return;
    }

    const notification = createNotification(type, {
      ...payload,
      projectId,
      projectName,
    } as NotificationDataMap[T]);

    await triggerNotification(recipients, notification);
  } catch (error) {
    console.error(`  Failed to send compliance notification "${type}":`, error);
  }
}

/**
 * The compliance slice of the notification registry.
 *
 * Narrowing `notifyCompliance` to these keys is what makes the
 * `Omit<…, "projectId" | "projectName">` above safe: every one of them carries
 * both fields, so removing them from the caller's payload cannot drop something
 * the template needs.
 */
type ComplianceNotificationPayloads = Pick<
  NotificationDataMap,
  | "certifierOutreachSent"
  | "certifierResponseReceived"
  | "complianceOutreachSent"
  | "complianceOutreachResponseReceived"
  | "complianceAlertRaised"
  | "complianceChecklistExtracted"
  | "complianceDocumentRejected"
  | "complianceReviewSent"
  | "complianceApproved"
  | "complianceDeveloperDecision"
  | "complianceDeveloperResent"
  | "complianceCertificateIssued"
  | "complianceCompleted"
  | "complianceDaItemsRequested"
>;
