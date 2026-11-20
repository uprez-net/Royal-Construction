import { ChecklistIssueEventKind, ChecklistIssueStatus } from "@prisma/client";

import { authorizeProjectRecording } from "../access/projects";
import { logAction } from "../audit/action-log";
import type { TransactionalDomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { DomainPrincipal } from "../principal";
import {
  checklistActor,
  loadChecklist,
  touchChecklist,
} from "./checklist-common";
import {
  isUniqueViolation,
  recordEvent,
  requireAssignableTradie,
  text,
} from "./checklist-issue-common";
import { CHECKLIST_LIMITS } from "./checklist-rules";

// Raising a defect against a checklist row (issue #420). Telling the tradie is
// `checklist-issue-email.ts`; moving it through its lifecycle is
// `checklist-issue-lifecycle.ts`.

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

  await authorizeProjectRecording(principal, input.projectId, db);
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

        await touchChecklist(checklist.id, tx);
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
