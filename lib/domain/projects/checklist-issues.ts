import {
  ChecklistIssueEventKind,
  ChecklistIssueStatus,
  ChecklistNotificationStatus,
  ChecklistSignaturePurpose,
  OutboxEventKind,
} from "@prisma/client";

import { authorizeProject } from "../access/projects";
import { logAction } from "../audit/action-log";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { ChecklistIssueEmailPort } from "../ports/checklist";
import type { DomainPrincipal } from "../principal";
import {
  CHECKLIST_LIMITS,
  ISSUE_STATUS_LABELS,
  canMoveIssue,
} from "./checklist-rules";
import {
  checklistActor,
  loadChecklist,
  requireReviewerName,
  requireSignature,
  touchChecklist,
  type ChecklistActor,
} from "./checklists";

// Defects raised against a checklist row (issue #420): raising one, telling
// the tradie, moving it through its lifecycle, and verifying the fix.
//
// The order matters for the one thing a client would notice — a tradie never
// hearing about a defect. The issue is written first and the email sent
// after, so a failed send leaves the issue, its photos and the edited email in
// place with the failure on the row and a retry beside it. Nothing reports
// "sent" unless Graph accepted the message.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(
  value: string | null | undefined,
  max: number,
  field: string,
): string {
  const result = value?.trim() ?? "";
  if (result.length > max) {
    throw new DomainValidationError(
      `Keep this under ${max.toLocaleString("en-AU")} characters.`,
      field,
    );
  }
  return result;
}

async function recordEvent(
  db: DomainDb,
  issueId: string,
  actor: ChecklistActor | null,
  event: {
    readonly kind: ChecklistIssueEventKind;
    readonly fromStatus?: ChecklistIssueStatus | null;
    readonly toStatus?: ChecklistIssueStatus | null;
    readonly note?: string | null;
  },
  at: Date,
) {
  await db.checklistIssueEvent.create({
    data: {
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      createdAt: at,
      fromStatus: event.fromStatus ?? null,
      issueId,
      kind: event.kind,
      note: event.note ?? null,
      toStatus: event.toStatus ?? null,
    },
  });
}

/** The issue, checked against the project it was named with. */
async function loadIssue(
  input: { readonly projectId: string; readonly issueId: string },
  db: DomainDb,
) {
  const issue = await db.checklistIssue.findFirst({
    include: {
      assignedTradie: { select: { email: true, id: true, name: true } },
      checklist: {
        select: {
          id: true,
          number: true,
          projectId: true,
          status: true,
          title: true,
        },
      },
      item: { select: { label: true, section: true } },
    },
    where: { checklist: { projectId: input.projectId }, id: input.issueId },
  });
  if (!issue)
    throw new DomainNotFoundError("That issue is not on this project.");
  return issue;
}

async function requireAssignableTradie(tradieId: string, db: DomainDb) {
  const tradie = await db.tradie.findUnique({
    select: { archivedAt: true, email: true, id: true, name: true },
    where: { id: tradieId },
  });
  if (!tradie || tradie.archivedAt) {
    throw new DomainNotFoundError(
      "That tradie is not in the directory any more. Choose another.",
    );
  }
  return tradie;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

export type RaiseChecklistIssueInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly itemId: string;
  readonly description: string;
  readonly comments?: string | null;
  /** Null saves it unassigned; nobody is emailed by default. */
  readonly assignedTradieId?: string | null;
  /**
   * Project File ids to attach as evidence: photos uploaded in the issue form
   * and photos already on the row.
   */
  readonly evidenceFileIds?: readonly string[];
  /** The browser's key for this press of Save. */
  readonly requestKey: string;
};

export type RaisedChecklistIssue = {
  readonly id: string;
  readonly number: number;
  readonly checklistId: string;
  /** True when this request key had already raised it. */
  readonly replayed: boolean;
};

/**
 * Raise a defect on one row. The row is flagged by the issue's existence;
 * the checklist cannot close until it is verified.
 */
export async function raiseChecklistIssue(
  principal: DomainPrincipal,
  input: RaiseChecklistIssueInput,
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<RaisedChecklistIssue> {
  const requestKey = input.requestKey.trim();
  if (!requestKey) {
    throw new DomainValidationError("A request key is required.");
  }
  const description = text(
    input.description,
    CHECKLIST_LIMITS.description,
    "description",
  );
  if (!description) {
    throw new DomainValidationError(
      "Describe what is wrong, so the tradie knows what to fix.",
      "description",
    );
  }
  const comments =
    text(input.comments, CHECKLIST_LIMITS.comments, "comments") || null;
  const fileIds = [...new Set(input.evidenceFileIds ?? [])];
  if (fileIds.length > CHECKLIST_LIMITS.photosPerUpload) {
    throw new DomainValidationError(
      `Attach up to ${CHECKLIST_LIMITS.photosPerUpload} photos to one issue.`,
      "evidenceFileIds",
    );
  }

  await authorizeProject(principal, input.projectId, db);
  const replay = await db.checklistIssue.findUnique({
    select: { checklistId: true, id: true, number: true },
    where: { requestKey },
  });
  if (replay) {
    if (replay.checklistId !== input.checklistId) {
      throw new DomainValidationError(
        "That request key belongs to another checklist.",
      );
    }
    return { ...replay, replayed: true };
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const actor = await checklistActor(principal, tx);
        const checklist = await loadChecklist(input, tx, {
          requireOpen: true,
        });
        const item = await tx.checklistItem.findFirst({
          select: { id: true, label: true, section: true },
          where: { checklistId: checklist.id, id: input.itemId },
        });
        if (!item) {
          throw new DomainNotFoundError("That row is not on this checklist.");
        }
        const tradie = input.assignedTradieId
          ? await requireAssignableTradie(input.assignedTradieId, tx)
          : null;

        if (fileIds.length > 0) {
          const files = await tx.file.findMany({
            select: { fileType: true, id: true },
            where: { id: { in: fileIds }, projectId: input.projectId },
          });
          if (files.length !== fileIds.length) {
            throw new DomainNotFoundError(
              "One of those photos is not on this project. Upload it again.",
            );
          }
          if (files.some((file) => !file.fileType.startsWith("image/"))) {
            throw new DomainValidationError(
              "Only photos can be attached as evidence.",
              "evidenceFileIds",
            );
          }
          const taken = await tx.checklistAttachment.findFirst({
            select: { id: true },
            where: {
              fileId: { in: fileIds },
              OR: [{ itemId: { not: item.id } }, { issueId: { not: null } }],
            },
          });
          if (taken) {
            throw new DomainValidationError(
              "One of those photos is already on another row or another issue.",
              "evidenceFileIds",
            );
          }
        }

        const last = await tx.checklistIssue.aggregate({
          _max: { number: true },
          where: { checklistId: checklist.id },
        });
        const issue = await tx.checklistIssue.create({
          data: {
            assignedTradieId: tradie?.id ?? null,
            checklistId: checklist.id,
            comments,
            createdAt: now,
            createdById: actor.id,
            description,
            itemId: item.id,
            number: (last._max.number ?? 0) + 1,
            requestKey,
          },
          select: { id: true, number: true },
        });

        if (fileIds.length > 0) {
          // A photo already on the row becomes evidence; a new one is added.
          await tx.checklistAttachment.updateMany({
            data: { issueId: issue.id },
            where: { fileId: { in: fileIds }, issueId: null, itemId: item.id },
          });
          const linked = await tx.checklistAttachment.findMany({
            select: { fileId: true },
            where: { fileId: { in: fileIds } },
          });
          const fresh = fileIds.filter(
            (fileId) => !linked.some((row) => row.fileId === fileId),
          );
          if (fresh.length > 0) {
            await tx.checklistAttachment.createMany({
              data: fresh.map((fileId) => ({
                fileId,
                issueId: issue.id,
                itemId: item.id,
                uploadedById: actor.id,
              })),
            });
          }
        }

        await recordEvent(
          tx,
          issue.id,
          actor,
          {
            kind: ChecklistIssueEventKind.CREATED,
            note: tradie ? `Assigned to ${tradie.name}` : "Saved unassigned",
            toStatus: ChecklistIssueStatus.OPEN,
          },
          now,
        );
        await touchChecklist(checklist.id, tx);
        await logAction(
          {
            authorId: actor.id,
            message: `Issue #${issue.number} raised on ${checklist.title}: ${item.section} – ${item.label}`,
            projectId: input.projectId,
            timestamp: now,
            type: "checklistIssueRaised",
          },
          tx,
        );
        return {
          checklistId: checklist.id,
          id: issue.id,
          number: issue.number,
          replayed: false,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The request key landed in a racing tab, or the number did.
      const raced = await db.checklistIssue.findUnique({
        select: { checklistId: true, id: true, number: true },
        where: { requestKey },
      });
      if (raced) return { ...raced, replayed: true };
      if (attempt >= 2) throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Telling the tradie
// ---------------------------------------------------------------------------

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

  try {
    const { replayed } = await runOutboxEffectWithOutcome(
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
        return { to };
      },
    );
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
      await touchChecklist(issue.checklistId, db);
    }
    return { issueId: issue.id, replayed, to };
  } catch (error) {
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
    if (isDomainError(error) && !(error instanceof DomainSideEffectError)) {
      // The outbox refusing a retry already says what to do; keep its words.
      throw error;
    }
    throw new DomainSideEffectError(operatorMessage, "email", true, {
      cause: error,
    });
  }
}

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

/**
 * Move an issue: start work, report it fixed, send it back, or reopen a
 * verified one. Verifying has its own command because it needs a signature.
 */
export async function changeChecklistIssueStatus(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly issueId: string;
    readonly to: ChecklistIssueStatus;
    readonly note?: string | null;
  },
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ readonly status: ChecklistIssueStatus }> {
  await authorizeProject(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const issue = await loadIssue(input, db);
  await loadChecklist(
    { checklistId: issue.checklistId, projectId: input.projectId },
    db,
    { requireOpen: true },
  );
  if (input.to === ChecklistIssueStatus.VERIFIED) {
    throw new DomainValidationError(
      "Verifying an issue needs the reviewer's name and signature.",
      "to",
    );
  }
  if (!canMoveIssue(issue.status, input.to)) {
    throw new DomainTransitionError(
      `An issue that is ${ISSUE_STATUS_LABELS[issue.status].toLowerCase()} cannot be moved to ${ISSUE_STATUS_LABELS[input.to].toLowerCase()}.`,
      issue.status,
      input.to,
    );
  }
  const note = text(input.note, CHECKLIST_LIMITS.note, "note") || null;
  const reopening = issue.status === ChecklistIssueStatus.VERIFIED;
  if (reopening && !note) {
    throw new DomainValidationError(
      "Say why a signed-off issue is being reopened.",
      "note",
    );
  }

  // Guarded on the status read above: a double-click moves it once.
  const moved = await db.checklistIssue.updateMany({
    data: {
      resolvedAt:
        input.to === ChecklistIssueStatus.RESOLVED ? now : issue.resolvedAt,
      status: input.to,
      ...(reopening
        ? { verificationNote: null, verifiedAt: null, verifiedById: null }
        : {}),
    },
    where: { id: issue.id, status: issue.status },
  });
  if (moved.count !== 1) {
    throw new DomainTransitionError(
      "This issue changed while you were working on it. Reload and try again.",
      issue.status,
      input.to,
    );
  }
  await recordEvent(
    db,
    issue.id,
    actor,
    {
      fromStatus: issue.status,
      kind: ChecklistIssueEventKind.STATUS_CHANGED,
      note: reopening ? `Reopened: ${note}` : note,
      toStatus: input.to,
    },
    now,
  );
  await touchChecklist(issue.checklistId, db);
  return { status: input.to };
}

/**
 * The reviewer inspected the fix and signs it off. Only a RESOLVED issue can
 * be verified: a fix has to be reported before it can be checked.
 */
export async function verifyChecklistIssue(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly issueId: string;
    readonly reviewerName: string;
    readonly signatureDataUrl: string;
    readonly note?: string | null;
  },
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<{ readonly status: ChecklistIssueStatus }> {
  const reviewerName = requireReviewerName(input.reviewerName);
  const signature = requireSignature(input.signatureDataUrl);
  const note = text(input.note, CHECKLIST_LIMITS.note, "note") || null;

  return db.$transaction(async (tx) => {
    await authorizeProject(principal, input.projectId, tx);
    const actor = await checklistActor(principal, tx);
    const issue = await loadIssue(input, tx);
    await loadChecklist(
      { checklistId: issue.checklistId, projectId: input.projectId },
      tx,
      { requireOpen: true },
    );
    if (issue.status !== ChecklistIssueStatus.RESOLVED) {
      throw new DomainTransitionError(
        issue.status === ChecklistIssueStatus.VERIFIED
          ? "This issue is already verified."
          : "Mark the issue resolved once the tradie has fixed it, then verify it.",
        issue.status,
        ChecklistIssueStatus.VERIFIED,
      );
    }
    const moved = await tx.checklistIssue.updateMany({
      data: {
        status: ChecklistIssueStatus.VERIFIED,
        verificationNote: note,
        verifiedAt: now,
        verifiedById: actor.id,
      },
      where: { id: issue.id, status: ChecklistIssueStatus.RESOLVED },
    });
    if (moved.count !== 1) {
      throw new DomainTransitionError(
        "This issue changed while you were signing it off. Reload and try again.",
        issue.status,
        ChecklistIssueStatus.VERIFIED,
      );
    }
    await tx.checklistSignature.create({
      data: {
        imageDataUrl: signature,
        issueId: issue.id,
        purpose: ChecklistSignaturePurpose.ISSUE_VERIFICATION,
        reviewerName,
        signedAt: now,
        signedById: actor.id,
      },
    });
    await recordEvent(
      tx,
      issue.id,
      actor,
      {
        fromStatus: issue.status,
        kind: ChecklistIssueEventKind.STATUS_CHANGED,
        note: note
          ? `Verified and signed off by ${reviewerName}: ${note}`
          : `Verified and signed off by ${reviewerName}`,
        toStatus: ChecklistIssueStatus.VERIFIED,
      },
      now,
    );
    await touchChecklist(issue.checklistId, tx);
    return { status: ChecklistIssueStatus.VERIFIED };
  });
}

/** Give the issue to a tradie, another tradie, or nobody. */
export async function assignChecklistIssue(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly issueId: string;
    readonly tradieId: string | null;
  },
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ readonly assignedTradieId: string | null }> {
  await authorizeProject(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const issue = await loadIssue(input, db);
  await loadChecklist(
    { checklistId: issue.checklistId, projectId: input.projectId },
    db,
    { requireOpen: true },
  );
  if (issue.assignedTradieId === input.tradieId) {
    return { assignedTradieId: input.tradieId };
  }
  const tradie = input.tradieId
    ? await requireAssignableTradie(input.tradieId, db)
    : null;
  await db.checklistIssue.update({
    data: {
      assignedTradieId: tradie?.id ?? null,
      // A new tradie has not been told yet.
      notificationError: null,
      notificationStatus: ChecklistNotificationStatus.NOT_SENT,
    },
    where: { id: issue.id },
  });
  await recordEvent(
    db,
    issue.id,
    actor,
    {
      kind: ChecklistIssueEventKind.ASSIGNED,
      note: tradie ? `Assigned to ${tradie.name}` : "Unassigned",
    },
    now,
  );
  await touchChecklist(issue.checklistId, db);
  return { assignedTradieId: tradie?.id ?? null };
}

/** A note on the issue's history: a call, a site visit, a promised date. */
export async function commentOnChecklistIssue(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly issueId: string;
    readonly note: string;
  },
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ readonly issueId: string }> {
  await authorizeProject(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const issue = await loadIssue(input, db);
  await loadChecklist(
    { checklistId: issue.checklistId, projectId: input.projectId },
    db,
    { requireOpen: true },
  );
  const note = text(input.note, CHECKLIST_LIMITS.note, "note");
  if (!note) throw new DomainValidationError("Write a comment.", "note");
  await recordEvent(
    db,
    issue.id,
    actor,
    { kind: ChecklistIssueEventKind.COMMENT, note },
    now,
  );
  await touchChecklist(issue.checklistId, db);
  return { issueId: issue.id };
}
