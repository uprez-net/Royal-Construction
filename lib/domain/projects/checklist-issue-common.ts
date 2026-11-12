import type {
  ChecklistIssueEventKind,
  ChecklistIssueStatus,
} from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { ChecklistActor } from "./checklist-common";

// What the checklist defect commands share: the issue checked against its
// project, its history row, and the tradie it may be assigned to.

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function text(
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

export async function recordEvent(
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
export async function loadIssue(
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

export async function requireAssignableTradie(tradieId: string, db: DomainDb) {
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

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}
