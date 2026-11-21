import { ChecklistSignaturePurpose, ChecklistStatus } from "@prisma/client";

import { authorizeProjectRecording } from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import type { TransactionalDomainDb } from "../db";
import {
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import {
  checklistActor,
  loadChecklist,
  requireReviewerName,
  requireSignature,
  trimmed,
} from "./checklist-common";
import {
  CHECKLIST_LIMITS,
  closureBlockers,
  describeClosureBlockers,
} from "./checklist-rules";

// Closing a checklist and reopening it (issue #420).

export type CloseChecklistInput = {
  readonly projectId: string;
  readonly checklistId: string;
  /** The revision the reviewer is looking at. A stale page is refused. */
  readonly expectedVersion: number;
  readonly reviewerName: string;
  readonly signatureDataUrl: string;
};

/**
 * Close the checklist: every row reviewed, every issue verified and signed
 * off, and the reviewer's name and signature captured. Checked here, inside
 * the transaction that closes it, not trusted from a disabled button.
 */
export async function closeChecklist(
  principal: DomainPrincipal,
  input: CloseChecklistInput,
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<{ readonly closedAt: Date; readonly version: number }> {
  const reviewerName = requireReviewerName(input.reviewerName);
  const signature = requireSignature(input.signatureDataUrl);

  return db.$transaction(async (tx) => {
    const project = await authorizeProjectRecording(
      principal,
      input.projectId,
      tx,
    );
    const actor = await checklistActor(principal, tx);
    const checklist = await loadChecklist(input, tx);
    if (checklist.version !== input.expectedVersion) {
      throw new DomainStaleVersionError(
        "This checklist changed since you opened it. Review the latest version before signing it off.",
        input.expectedVersion,
        checklist.version,
      );
    }
    const [items, issues] = await Promise.all([
      tx.checklistItem.findMany({
        select: { id: true, state: true },
        where: { checklistId: checklist.id },
      }),
      tx.checklistIssue.findMany({
        select: { id: true, itemId: true, status: true },
        where: { checklistId: checklist.id },
      }),
    ]);
    const blockers = closureBlockers({
      issues,
      items,
      status: checklist.status,
    });
    if (!blockers.canClose) {
      throw new DomainTransitionError(
        describeClosureBlockers(blockers),
        checklist.status,
        ChecklistStatus.CLOSED,
      );
    }

    // Guarded on the version read above, so a second tab closing at the same
    // moment finds nothing to update instead of signing twice.
    const closed = await tx.projectChecklist.updateMany({
      data: {
        closedAt: now,
        closedById: actor.id,
        status: ChecklistStatus.CLOSED,
        version: { increment: 1 },
      },
      where: {
        id: checklist.id,
        status: ChecklistStatus.OPEN,
        version: input.expectedVersion,
      },
    });
    if (closed.count !== 1) {
      throw new DomainStaleVersionError(
        "This checklist changed while you were signing it. Reload and try again.",
      );
    }
    await tx.checklistSignature.create({
      data: {
        checklistId: checklist.id,
        imageDataUrl: signature,
        purpose: ChecklistSignaturePurpose.CHECKLIST_CLOSURE,
        reviewerName,
        signedAt: now,
        signedById: actor.id,
      },
    });
    await logActionOrThrow(
      {
        authorId: actor.id,
        message: `${checklist.title} closed and signed off by ${reviewerName} for ${project.name}`,
        projectId: input.projectId,
        timestamp: now,
        type: "checklistClosed",
      },
      tx,
    );
    return { closedAt: now, version: input.expectedVersion + 1 };
  });
}

/**
 * Reopen a closed checklist. Admin only, with a reason, because it takes back
 * a signed-off inspection.
 */
export async function reopenChecklist(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly reason: string;
  },
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<{ readonly version: number }> {
  requireAdminPrincipal(principal);
  const reason = trimmed(input.reason, CHECKLIST_LIMITS.note, "reason");
  if (!reason) {
    throw new DomainValidationError(
      "Say why the checklist is being reopened. It is kept in the project history.",
      "reason",
    );
  }
  return db.$transaction(async (tx) => {
    const project = await authorizeProjectRecording(
      principal,
      input.projectId,
      tx,
    );
    const actor = await checklistActor(principal, tx);
    const checklist = await loadChecklist(input, tx);
    if (checklist.status !== ChecklistStatus.CLOSED) {
      throw new DomainTransitionError(
        "This checklist is not closed.",
        checklist.status,
        ChecklistStatus.OPEN,
      );
    }
    const updated = await tx.projectChecklist.update({
      data: {
        closedAt: null,
        closedById: null,
        status: ChecklistStatus.OPEN,
        version: { increment: 1 },
      },
      select: { version: true },
      where: { id: checklist.id },
    });
    await logActionOrThrow(
      {
        authorId: actor.id,
        message: `${checklist.title} reopened by ${actor.name} for ${project.name}: ${reason}`,
        projectId: input.projectId,
        timestamp: now,
        type: "checklistReopened",
      },
      tx,
    );
    return { version: updated.version };
  });
}
