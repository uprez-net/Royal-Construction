import { authorizeMilestoneRecording } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import {
  type DomainPrincipal,
  isInternalRole,
  isUserPrincipal,
} from "../principal";
import {
  MILESTONE_NOTE_MAX_LENGTH,
  canDeleteMilestoneNote,
  canSeeMilestoneNotes,
} from "./milestone-note-rules";

// Staff notes on an activity in the Milestones tab.
//
// A note is the office's working remark — "council rang, inspection moved to
// Thursday" — and is internal. A site update is the job's record, with photos,
// and is not. They are kept apart so that a customer account, which can be
// served the project page, never receives a note.

export type MilestoneNoteRecord = {
  readonly id: string;
  readonly milestoneId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly authorId: string | null;
  readonly author: { readonly id: string; readonly name: string } | null;
};

const NOTE_SELECT = {
  id: true,
  milestoneId: true,
  body: true,
  createdAt: true,
  authorId: true,
  author: { select: { id: true, name: true } },
} as const;

/**
 * Adds a note to one activity, attributed to the signed-in staff member.
 *
 * A note says who wrote it, so only a signed-in user may write one: a cron or
 * the system principal has nobody to attribute it to.
 */
export async function addMilestoneNote(
  principal: DomainPrincipal,
  input: { readonly milestoneId: string; readonly body: string },
  db: DomainDb,
): Promise<MilestoneNoteRecord> {
  if (!isUserPrincipal(principal) || !isInternalRole(principal.role)) {
    throw new DomainAuthorizationError("Only staff can add notes.");
  }
  const body = input.body.trim();
  if (body.length === 0) {
    throw new DomainValidationError("Write something in the note.", "body");
  }
  if (body.length > MILESTONE_NOTE_MAX_LENGTH) {
    throw new DomainValidationError(
      `A note can be at most ${MILESTONE_NOTE_MAX_LENGTH} characters.`,
      "body",
    );
  }
  await authorizeMilestoneRecording(principal, input.milestoneId, db);

  return db.milestoneNote.create({
    data: {
      milestoneId: input.milestoneId,
      authorId: principal.userId,
      body,
    },
    select: NOTE_SELECT,
  });
}

/**
 * Deletes one note, for its author or an admin.
 *
 * `milestoneId` is the activity the caller believes the note is on; a note on
 * another one is answered as not found, so a stale screen cannot delete a note
 * it is not showing.
 */
export async function deleteMilestoneNote(
  principal: DomainPrincipal,
  input: { readonly milestoneId: string; readonly noteId: string },
  db: DomainDb,
): Promise<{ readonly id: string; readonly milestoneId: string }> {
  if (!canSeeMilestoneNotes(principal)) {
    throw new DomainAuthorizationError("Only staff can delete notes.");
  }
  const note = await db.milestoneNote.findUnique({
    where: { id: input.noteId },
    select: { id: true, milestoneId: true, authorId: true },
  });
  if (!note || note.milestoneId !== input.milestoneId) {
    throw new DomainNotFoundError("This note was already deleted.");
  }
  await authorizeMilestoneRecording(principal, note.milestoneId, db);
  if (!canDeleteMilestoneNote(principal, note)) {
    throw new DomainAuthorizationError(
      "Only the person who wrote this note, or an admin, can delete it.",
    );
  }

  // deleteMany, not delete: a second click that lands after the first has
  // removed it must not surface Prisma's "record not found" as a 500.
  const { count } = await db.milestoneNote.deleteMany({
    where: { id: note.id },
  });
  if (count === 0) {
    throw new DomainNotFoundError("This note was already deleted.");
  }
  return { id: note.id, milestoneId: note.milestoneId };
}
