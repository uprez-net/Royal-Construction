import { ChecklistItemState } from "@prisma/client";

import { authorizeProjectRecording } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { BlobDeletePort } from "../ports/blob";
import { requireUserPrincipal, type DomainPrincipal } from "../principal";
import {
  checklistActor,
  loadChecklist,
  touchChecklist,
  trimmed,
} from "./checklist-common";
import { CHECKLIST_LIMITS, isBlockingIssue } from "./checklist-rules";

// Reviewing a checklist's rows (issue #420): ticking, N/A with a reason, the
// header and comment fields, and the photos on each row.
//
// Every write bumps the checklist's revision first, guarded on it still being
// open, so a write racing a close in another tab is refused rather than
// landing on a signed-off checklist.

export type SetChecklistItemStateInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly itemId: string;
  readonly state: ChecklistItemState;
  /** Required when the row does not apply to this house. */
  readonly naReason?: string | null;
};

/** Tick a row, untick it, or mark it not applicable with a reason. */
export async function setChecklistItemState(
  principal: DomainPrincipal,
  input: SetChecklistItemStateInput,
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ readonly itemId: string; readonly state: ChecklistItemState }> {
  await authorizeProjectRecording(principal, input.projectId, db);
  const actor = requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const item = await db.checklistItem.findFirst({
    select: {
      id: true,
      issues: { select: { status: true } },
    },
    where: { checklistId: checklist.id, id: input.itemId },
  });
  if (!item)
    throw new DomainNotFoundError("That row is not on this checklist.");

  let naReason: string | null = null;
  if (input.state === ChecklistItemState.NOT_APPLICABLE) {
    naReason = trimmed(input.naReason, CHECKLIST_LIMITS.naReason, "naReason");
    if (!naReason) {
      throw new DomainValidationError(
        "Say why this does not apply to the house, so the document records it.",
        "naReason",
      );
    }
    if (item.issues.some((issue) => isBlockingIssue(issue.status))) {
      throw new DomainValidationError(
        "This row has an open issue. Resolve and verify it before marking the row not applicable.",
        "state",
      );
    }
  }

  await touchChecklist(checklist.id, db);
  await db.checklistItem.update({
    data: {
      naReason,
      reviewedAt: input.state === ChecklistItemState.UNCHECKED ? null : now,
      reviewedById:
        input.state === ChecklistItemState.UNCHECKED ? null : actor.userId,
      state: input.state,
    },
    where: { id: item.id },
  });
  return { itemId: item.id, state: input.state };
}

/** The source document's header and footer fields. */
export async function updateChecklistDetails(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly comments?: string | null;
    readonly checkedBy?: string | null;
  },
  db: DomainDb,
): Promise<{
  readonly comments: string | null;
  readonly checkedBy: string | null;
}> {
  await authorizeProjectRecording(principal, input.projectId, db);
  requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const data: { comments?: string | null; checkedBy?: string | null } = {};
  if (input.comments !== undefined) {
    data.comments =
      trimmed(input.comments, CHECKLIST_LIMITS.comments, "comments") || null;
  }
  if (input.checkedBy !== undefined) {
    data.checkedBy =
      trimmed(input.checkedBy, CHECKLIST_LIMITS.reviewerName, "checkedBy")
      || null;
  }
  await touchChecklist(checklist.id, db);
  const updated = await db.projectChecklist.update({
    data,
    select: { checkedBy: true, comments: true },
    where: { id: checklist.id },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type AttachChecklistPhotosInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly itemId: string;
  /** Project File ids, already uploaded and confirmed. */
  readonly fileIds: readonly string[];
  /** Attach as evidence for this issue on the same row. */
  readonly issueId?: string | null;
};

/**
 * Link uploaded photos to an inspection row, and optionally to one of its
 * issues as evidence. Idempotent for a retry: a photo already on this row is
 * left where it is (and becomes evidence if asked); one on another row is
 * refused rather than moved.
 */
export async function attachChecklistPhotos(
  principal: DomainPrincipal,
  input: AttachChecklistPhotosInput,
  db: DomainDb,
): Promise<{ readonly attached: number }> {
  await authorizeProjectRecording(principal, input.projectId, db);
  const actor = requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const fileIds = [...new Set(input.fileIds)];
  if (fileIds.length === 0) return { attached: 0 };
  if (fileIds.length > CHECKLIST_LIMITS.photosPerUpload) {
    throw new DomainValidationError(
      `Attach up to ${CHECKLIST_LIMITS.photosPerUpload} photos at a time.`,
      "fileIds",
    );
  }

  const item = await db.checklistItem.findFirst({
    select: { id: true },
    where: { checklistId: checklist.id, id: input.itemId },
  });
  if (!item)
    throw new DomainNotFoundError("That row is not on this checklist.");

  let issueId: string | null = null;
  if (input.issueId) {
    const issue = await db.checklistIssue.findFirst({
      select: { id: true, itemId: true },
      where: { checklistId: checklist.id, id: input.issueId },
    });
    if (!issue || issue.itemId !== item.id) {
      throw new DomainNotFoundError("That issue is not on this row.");
    }
    issueId = issue.id;
  }

  const files = await db.file.findMany({
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
      "Only photos can be attached to an inspection row.",
      "fileIds",
    );
  }

  const existing = await db.checklistAttachment.findMany({
    select: { fileId: true, issueId: true, itemId: true },
    where: { fileId: { in: fileIds } },
  });
  if (existing.some((row) => row.itemId !== item.id)) {
    throw new DomainValidationError(
      "One of those photos is already on another inspection row.",
      "fileIds",
    );
  }
  if (
    issueId
    && existing.some((row) => row.issueId !== null && row.issueId !== issueId)
  ) {
    throw new DomainValidationError(
      "One of those photos is already evidence for another issue.",
      "fileIds",
    );
  }

  await touchChecklist(checklist.id, db);
  const fresh = fileIds.filter(
    (fileId) => !existing.some((row) => row.fileId === fileId),
  );
  if (fresh.length > 0) {
    await db.checklistAttachment.createMany({
      data: fresh.map((fileId) => ({
        fileId,
        issueId,
        itemId: item.id,
        uploadedById: actor.userId,
      })),
      skipDuplicates: true,
    });
  }
  if (issueId) {
    await db.checklistAttachment.updateMany({
      data: { issueId },
      where: { fileId: { in: fileIds }, issueId: null, itemId: item.id },
    });
    const who = await checklistActor(principal, db);
    await db.checklistIssueEvent.create({
      data: {
        actorId: who.id,
        actorName: who.name,
        issueId,
        kind: "EVIDENCE_ADDED",
        note: `${fileIds.length} photo${fileIds.length === 1 ? "" : "s"} added`,
      },
    });
  }
  return { attached: fileIds.length };
}

/**
 * Remove a photo attached by mistake. Evidence for an issue is kept: once it
 * has been sent to a tradie or verified against, it is the record.
 */
export async function removeChecklistPhoto(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly attachmentId: string;
  },
  db: DomainDb,
  deleteBlob: BlobDeletePort,
): Promise<{ readonly removed: true }> {
  await authorizeProjectRecording(principal, input.projectId, db);
  requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const attachment = await db.checklistAttachment.findFirst({
    include: {
      file: true,
      issue: { select: { number: true } },
    },
    where: { id: input.attachmentId, item: { checklistId: checklist.id } },
  });
  if (!attachment) {
    throw new DomainNotFoundError("That photo is not on this checklist.");
  }
  if (attachment.issueId) {
    throw new DomainValidationError(
      `This photo is evidence for issue #${attachment.issue?.number ?? ""} and is kept with it.`,
      "attachmentId",
    );
  }

  await touchChecklist(checklist.id, db);
  const file = attachment.file;
  // A photo uploaded for this row is only this row's. One that is also on a
  // lead, a milestone or a compliance document keeps its file.
  const ownedHere =
    file.leadId === null
    && file.milestoneId === null
    && file.complianceDocumentId === null
    && file.incidentId === null;
  if (ownedHere) {
    // Cascades the attachment row.
    await db.file.delete({ where: { id: file.id } });
  } else {
    await db.checklistAttachment.delete({ where: { id: attachment.id } });
  }
  if (ownedHere) {
    try {
      await deleteBlob(file.url);
    } catch (error) {
      // The rows are gone; an orphaned object costs storage, not data.
      console.error("[checklists] photo storage cleanup failed", error);
    }
  }
  return { removed: true };
}
