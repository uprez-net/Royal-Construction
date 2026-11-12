import {
  ChecklistIssueEventKind,
  ChecklistIssueStatus,
  ChecklistNotificationStatus,
  OutboxEventKind,
} from "@prisma/client";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { ChecklistIssueEmailPort } from "../ports/checklist";
import type { DomainPrincipal } from "../principal";
import {
  checklistActor,
  loadChecklist,
  touchChecklist,
} from "./checklist-common";
import {
  EMAIL_RE,
  loadIssue,
  recordEvent,
  text,
} from "./checklist-issue-common";
import { CHECKLIST_LIMITS } from "./checklist-rules";

// Telling the tradie about a checklist defect (issue #420).
//
// The issue is written before this runs, so a failed send leaves the issue,
// its photos and the edited email in place with the failure on the row and a
// retry beside it. Nothing reports "sent" unless Graph accepted the message,
// and nothing reports "failed" for an email that went.

export type SendChecklistIssueEmailInput = {
  readonly projectId: string;
  readonly issueId: string;
  readonly subject: string;
  readonly body: string;
  /**
   * The browser's key for this press of Send or Retry. The email is keyed on
   * it, so a replayed request does not email the tradie twice while a retry
   * somebody chose to press is a new email.
   */
  readonly attemptKey: string;
};

export type SentChecklistIssueEmail = {
  readonly issueId: string;
  readonly to: string;
  /** The email for this attempt had already gone; nothing was re-sent. */
  readonly replayed: boolean;
};

/**
 * Email the assigned tradie, with the issue's photos attached. A failure is
 * written on the issue and refused, never reported as sent.
 */
export async function sendChecklistIssueEmail(
  principal: DomainPrincipal,
  input: SendChecklistIssueEmailInput,
  db: DomainDb,
  sendEmail: ChecklistIssueEmailPort,
  now: Date = new Date(),
): Promise<SentChecklistIssueEmail> {
  await authorizeProject(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const issue = await loadIssue(input, db);
  await loadChecklist(
    { checklistId: issue.checklistId, projectId: input.projectId },
    db,
    { requireOpen: true },
  );
  if (issue.status === ChecklistIssueStatus.VERIFIED) {
    throw new DomainTransitionError(
      "This issue is already verified and signed off.",
      issue.status,
      "NOTIFY",
    );
  }
  const attemptKey = input.attemptKey.trim();
  if (!attemptKey) {
    throw new DomainValidationError("An attempt key is required.");
  }
  const tradie = issue.assignedTradie;
  if (!tradie) {
    throw new DomainValidationError(
      "Choose the responsible tradie before sending. The issue can stay unassigned without an email.",
      "assignedTradieId",
    );
  }
  const to = tradie.email.trim();
  if (!EMAIL_RE.test(to)) {
    throw new DomainValidationError(
      `${tradie.name} has no valid email address. Correct it in the tradie directory.`,
      "assignedTradieId",
    );
  }
  const subject = text(
    input.subject,
    CHECKLIST_LIMITS.emailSubject,
    "emailSubject",
  );
  const body = text(input.body, CHECKLIST_LIMITS.emailBody, "emailBody");
  if (!subject || !body) {
    throw new DomainValidationError(
      "The email needs a subject and a message.",
      subject ? "emailBody" : "emailSubject",
    );
  }

  // Bumped first: it also refuses if the checklist was closed meanwhile, so no
  // email goes out about a signed-off checklist.
  await touchChecklist(issue.checklistId, db);
  // Kept before sending, so a retry after a failure sends what was edited.
  await db.checklistIssue.update({
    data: { emailBody: body, emailSubject: subject },
    where: { id: issue.id },
  });

  const photos = await db.checklistAttachment.findMany({
    orderBy: { createdAt: "asc" },
    select: { file: { select: { fileType: true, filename: true, url: true } } },
    where: { issueId: issue.id },
  });

  // Set once Graph has accepted the message. After that, nothing that goes
  // wrong can be reported as a failed send: the tradie has the email, and a
  // "failed" badge would prompt the office to send it twice.
  let delivered = false;
  let replayed = false;
  try {
    ({ replayed } = await runOutboxEffectWithOutcome(
      db,
      {
        key: `checklist-issue-email:${issue.id}:${attemptKey}`,
        kind: OutboxEventKind.CHECKLIST_ISSUE_EMAIL_SEND,
        payload: { issueId: issue.id, subject, to },
      },
      async () => {
        await sendEmail({
          body,
          photos: photos.map(({ file }) => ({
            contentType: file.fileType,
            filename: file.filename,
            url: file.url,
          })),
          subject,
          to,
        });
        delivered = true;
        return { to };
      },
    ));
  } catch (error) {
    if (!delivered) {
      if (isDomainError(error) && !(error instanceof DomainSideEffectError)) {
        // The outbox refusing this attempt key: nothing was attempted now,
        // and its words already say what to do. The issue is left as it was.
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const operatorMessage = `The email to ${tradie.name} was not sent: ${reason}`;
      await db.checklistIssue.update({
        data: {
          notificationError: operatorMessage,
          notificationStatus: ChecklistNotificationStatus.FAILED,
        },
        where: { id: issue.id },
      });
      await recordEvent(
        db,
        issue.id,
        actor,
        { kind: ChecklistIssueEventKind.EMAIL_FAILED, note: operatorMessage },
        now,
      );
      throw new DomainSideEffectError(operatorMessage, "email", true, {
        cause: error,
      });
    }
    // Delivered, but the outbox could not record its outcome. The email went,
    // so it is recorded as sent below; the outbox row is left for a human,
    // and a replay of this attempt key is refused rather than resent.
  }

  if (!replayed) {
    await db.checklistIssue.update({
      data: {
        notificationError: null,
        notificationStatus: ChecklistNotificationStatus.SENT,
        notifiedAt: now,
        notifiedTo: to,
      },
      where: { id: issue.id },
    });
    await recordEvent(
      db,
      issue.id,
      actor,
      {
        kind: ChecklistIssueEventKind.EMAIL_SENT,
        note: `Emailed ${tradie.name} <${to}>${photos.length > 0 ? ` with ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}`,
      },
      now,
    );
  }
  return { issueId: issue.id, replayed, to };
}
