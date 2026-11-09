import { Role } from "@prisma/client";

import {
  type DomainPrincipal,
  isInternalPrincipal,
  isUserPrincipal,
} from "../principal";

// Who may see and delete a staff note on an activity. Pure, so the Milestones
// tab asks the same rule the commands in `milestone-notes.ts` enforce, rather
// than a second copy of it deciding which delete buttons to draw.

/** Long enough for a paragraph; short enough to stay a note. */
export const MILESTONE_NOTE_MAX_LENGTH = 2000;

/** Staff, and the system acting for the business. Never a customer. */
export function canSeeMilestoneNotes(principal: DomainPrincipal): boolean {
  return isInternalPrincipal(principal);
}

/**
 * The note's author, or an admin.
 *
 * An admin may tidy up after anyone; a site manager only after themselves, so
 * one person's note cannot quietly vanish under another's login.
 */
export function canDeleteMilestoneNote(
  principal: DomainPrincipal,
  note: { readonly authorId: string | null },
): boolean {
  if (!isUserPrincipal(principal)) return false;
  if (principal.role === Role.ADMIN) return true;
  return note.authorId !== null && note.authorId === principal.userId;
}
