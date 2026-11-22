import {
  ChecklistIssueEventKind,
  ChecklistIssueStatus,
  ChecklistNotificationStatus,
  ChecklistSignaturePurpose,
} from "@prisma/client";

import { authorizeProjectRecording } from "../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainTransitionError, DomainValidationError } from "../errors";
import type { DomainPrincipal } from "../principal";
import {
  checklistActor,
  loadChecklist,
  requireReviewerName,
  requireSignature,
  touchChecklist,
} from "./checklist-common";
import {
  loadIssue,
  recordEvent,
  requireAssignableTradie,
  text,
} from "./checklist-issue-common";
import {
  CHECKLIST_LIMITS,
  ISSUE_STATUS_LABELS,
  canMoveIssue,
} from "./checklist-rules";

// A checklist defect's lifecycle (issue #420): Open, In progress, Resolved,
// then Verified with the reviewer's signature; reassigning; comments. Only
// VERIFIED stops an issue blocking the checklist from closing.

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
  await authorizeProjectRecording(principal, input.projectId, db);
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

  await touchChecklist(issue.checklistId, db);
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
    await authorizeProjectRecording(principal, input.projectId, tx);
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
    await touchChecklist(issue.checklistId, tx);
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
  await authorizeProjectRecording(principal, input.projectId, db);
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
  await touchChecklist(issue.checklistId, db);
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
  await authorizeProjectRecording(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const issue = await loadIssue(input, db);
  await loadChecklist(
    { checklistId: issue.checklistId, projectId: input.projectId },
    db,
    { requireOpen: true },
  );
  const note = text(input.note, CHECKLIST_LIMITS.note, "note");
  if (!note) throw new DomainValidationError("Write a comment.", "note");
  await touchChecklist(issue.checklistId, db);
  await recordEvent(
    db,
    issue.id,
    actor,
    { kind: ChecklistIssueEventKind.COMMENT, note },
    now,
  );
  return { issueId: issue.id };
}
