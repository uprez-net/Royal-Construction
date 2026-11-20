import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import { Role } from "@prisma/client";

import {
  type DomainPrincipal,
  isOfficePrincipal,
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

/**
 * The office reads every lead; a customer only the leads assigned to them; a
 * site manager none at all. `isOfficePrincipal`, not `isInternalPrincipal`: a
 * site manager is staff for projects but has no business with a prospect's
 * name, number or quoted price (see `isOfficeRole`).
 *
 * A site manager is refused even on a lead assigned to them. New assignments
 * to one are refused (`assertOfficeAssignee`), but a lead assigned before
 * that rule, or to someone since moved out of the office, would otherwise
 * still open for them.
 */
export function canAccessLead(
  principal: DomainPrincipal,
  lead: AccessibleLead,
): boolean {
  if (isOfficePrincipal(principal)) return true;
  return (
    isUserPrincipal(principal)
    && principal.role !== Role.SITE_MANAGER
    && lead.assignedId === principal.userId
  );
}

/**
 * The scope a site manager lists leads with: an assignee no user can be. The
 * nil UUID, because `uuid()` never mints it, and because a value in the id's
 * own format is safe wherever the scope reaches raw SQL. Every reader that
 * filters on a non-null `assignedId` then matches no lead, which is what
 * `canAccessLead` answers for each one.
 */
export const NO_LEADS_ASSIGNEE = "00000000-0000-0000-0000-000000000000";

/**
 * `canAccessLead`'s rule, expressed as a filter for list queries.
 *
 * A listing cannot run the per-lead check on every row it returns, so it
 * pushes the same rule into the query: the office reads every lead, a site
 * manager none (`NO_LEADS_ASSIGNEE`), anyone else only the leads assigned to
 * them. Keep the two in step, or a list shows
 * a row whose page then refuses to open.
 *
 * `assignedId: null` means "no filter", not "leads with no assignee" —
 * an encoding `requireInternalUser` reads directly to decide who is office
 * staff, so narrowing this rule also narrows every action it guards.
 */
export type LeadListScope = { assignedId: string | null };

export function leadListScope(principal: DomainPrincipal): LeadListScope {
  if (isOfficePrincipal(principal)) return { assignedId: null };
  // No leads, rather than a refusal: the voice briefing and the comms reads
  // ask for a site manager's scope in passing, and "none" is the true answer.
  if (isUserPrincipal(principal) && principal.role === Role.SITE_MANAGER) {
    return { assignedId: NO_LEADS_ASSIGNEE };
  }
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
