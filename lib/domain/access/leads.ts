import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import {
  type DomainPrincipal,
  isInternalPrincipal,
  isUserPrincipal,
} from "../principal";

// Who may read a lead, as one rule.
//
// Moved here from lib/offer/access.ts, which was already the single owner and
// already Node-safe — it is the pattern the rest of this migration copies, not
// a duplicate being untangled. What changes is the caller type: a
// DomainPrincipal instead of a User row, so a cron and the booking route can
// be answered too instead of each inventing its own idea of "no user".

export type AccessibleLead = {
  id: number;
  assignedId: string | null;
};

export function canAccessLead(
  principal: DomainPrincipal,
  lead: AccessibleLead,
): boolean {
  if (isInternalPrincipal(principal)) return true;
  return isUserPrincipal(principal) && lead.assignedId === principal.userId;
}

/**
 * `canAccessLead`'s rule, expressed as a filter for list queries.
 *
 * A listing cannot run the per-lead check on every row it returns, so it
 * pushes the same rule into the query: internal roles read every lead, anyone
 * else only the leads assigned to them. Keep the two in step, or a list shows
 * a row whose page then refuses to open.
 *
 * `assignedId: null` means "no filter", not "leads with no assignee" —
 * an encoding `requireInternalUser` reads directly to decide who is staff.
 */
export type LeadListScope = { assignedId: string | null };

export function leadListScope(principal: DomainPrincipal): LeadListScope {
  if (isInternalPrincipal(principal)) return { assignedId: null };
  if (isUserPrincipal(principal)) return { assignedId: principal.userId };
  // No open route lists leads, and a scope that silently matched nothing would
  // read as "this account has no leads" rather than "you may not ask".
  throw new DomainAuthorizationError(
    "Listing leads requires a signed-in user.",
  );
}

/**
 * Assert this caller may read this lead, and return it.
 *
 * Missing and forbidden stay distinct here — both are refusals the operator
 * sees, and "no such lead" is not information worth hiding from staff who can
 * list every lead anyway.
 */
export async function authorizeLead(
  principal: DomainPrincipal,
  leadId: number,
  db: DomainDb,
): Promise<AccessibleLead> {
  const lead = await db.lead.findUnique({
    select: { assignedId: true, id: true },
    where: { id: leadId },
  });

  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  return lead;
}
