import { ChecklistStatus } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { requireUserPrincipal, type DomainPrincipal } from "../principal";
import { CHECKLIST_LIMITS, isValidSignatureDataUrl } from "./checklist-rules";

// What every checklist write shares: who is writing, the checklist checked
// against its project, the guarded revision bump, and the reviewer fields.

export type ChecklistActor = { readonly id: string; readonly name: string };

/** Who is writing, with a name snapshot for the history. */
export async function checklistActor(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<ChecklistActor> {
  const user = requireUserPrincipal(principal);
  const row = await db.user.findUnique({
    select: { name: true },
    where: { id: user.userId },
  });
  return { id: user.userId, name: row?.name ?? "Unknown user" };
}

type LoadedChecklist = {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly status: ChecklistStatus;
  readonly version: number;
  readonly templateKey: string;
};

/**
 * The checklist, checked against the project it was named with. A checklist
 * id copied from another project reads as absent.
 */
export async function loadChecklist(
  input: { readonly projectId: string; readonly checklistId: string },
  db: DomainDb,
  options: { readonly requireOpen?: boolean } = {},
): Promise<LoadedChecklist> {
  const row = await db.projectChecklist.findFirst({
    select: {
      id: true,
      number: true,
      projectId: true,
      status: true,
      templateKey: true,
      title: true,
      version: true,
    },
    where: { id: input.checklistId, projectId: input.projectId },
  });
  if (!row)
    throw new DomainNotFoundError("That checklist is not on this project.");
  if (options.requireOpen && row.status === ChecklistStatus.CLOSED) {
    throw new DomainTransitionError(
      "This checklist is closed. Reopen it before making changes.",
      row.status,
      "EDIT",
    );
  }
  return row;
}

/**
 * Record that the checklist is about to change: a new revision for its next
 * document. Guarded on the checklist still being open, and called BEFORE the
 * change it announces, so a write racing a close in another tab is refused
 * instead of landing on a signed-off checklist. Closing is guarded on the
 * revision it read, so a bump that wins the race makes the close refuse
 * instead.
 */
export async function touchChecklist(
  checklistId: string,
  db: DomainDb,
): Promise<void> {
  const touched = await db.projectChecklist.updateMany({
    data: { version: { increment: 1 } },
    where: { id: checklistId, status: ChecklistStatus.OPEN },
  });
  if (touched.count !== 1) {
    throw new DomainTransitionError(
      "This checklist was closed while you were working on it. Reopen it before making changes.",
      ChecklistStatus.CLOSED,
      "EDIT",
    );
  }
}

export function trimmed(
  value: string | null | undefined,
  max: number,
  field: string,
) {
  const text = value?.trim() ?? "";
  if (text.length > max) {
    throw new DomainValidationError(
      `Keep this under ${max.toLocaleString("en-AU")} characters.`,
      field,
    );
  }
  return text;
}

export function requireReviewerName(value: string): string {
  const name = trimmed(value, CHECKLIST_LIMITS.reviewerName, "reviewerName");
  if (!name) {
    throw new DomainValidationError(
      "Enter the reviewer's name.",
      "reviewerName",
    );
  }
  return name;
}

export function requireSignature(value: string): string {
  if (!isValidSignatureDataUrl(value)) {
    throw new DomainValidationError(
      "Draw or upload the reviewer's signature.",
      "signature",
    );
  }
  return value;
}
