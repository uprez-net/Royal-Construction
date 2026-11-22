import { isOwnMailbox } from "@/lib/graph/mailbox";

/**
 * A client's email is never one of our own mailboxes.
 *
 * `Lead.email` is what the inbound gate matches on and where the welcome and
 * every composed email go, so a lead holding info@ or admin@ mails the office
 * its own client mail and, worse, matches every later message from the
 * business. Four such leads exist in production (#590). The inbound path was
 * guarded (`resolveLeadEmail`); the manual, API, booking and Eve paths were
 * not, and they all end in `createLead` / `updateLead`.
 */
export const OWN_MAILBOX_MESSAGE =
  "That is one of Royal Constructions' own mailboxes, not the client's. Enter the client's own email address.";

/** The message to refuse with, or null when the address may be a client's. */
export function ownMailboxRefusal(
  email: string | null | undefined,
): string | null {
  return isOwnMailbox(email) ? OWN_MAILBOX_MESSAGE : null;
}

/**
 * Whether an edit that sets `next` over `current` introduces an own mailbox.
 *
 * Only a change is judged: the four leads already holding one must stay
 * editable (a name, a stage) until someone corrects the address, so an
 * unchanged value is let through.
 */
export function introducesOwnMailbox(
  next: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const n = (next ?? "").trim().toLowerCase();
  const c = (current ?? "").trim().toLowerCase();
  return n !== "" && n !== c && isOwnMailbox(n);
}
