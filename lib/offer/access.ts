import prisma from "@/lib/prisma";
import type { Prisma, User } from "@prisma/client";

import {
  type AccessibleLead,
  type LeadListScope,
  authorizeLead,
  canAccessLead as canAccessLeadDomain,
  leadListScope as leadListScopeDomain,
} from "@/lib/domain/access/leads";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";

// The lead access rule now lives in lib/domain/access/leads.ts, where a cron,
// a webhook and the booking route can reach it as well as a page.
//
// This module stays as the adapter the existing callers already import: it
// converts a User row into a DomainPrincipal, supplies the ambient Prisma
// client, and translates the domain errors back into LeadAccessError so the
// route handlers that map `.status` keep working. Callers move over
// module-by-module as their phase lands; the rule itself has one home from
// now on.

export type { AccessibleLead, LeadListScope };

export class LeadAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "LeadAccessError";
  }
}

export function canAccessLead(
  user: Pick<User, "id" | "role">,
  lead: AccessibleLead,
): boolean {
  return canAccessLeadDomain(userPrincipal(user), lead);
}

export function leadListScope(user: Pick<User, "id" | "role">): LeadListScope {
  return leadListScopeDomain(userPrincipal(user));
}

export async function assertCanAccessLead(
  user: Pick<User, "id" | "role">,
  leadId: number,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AccessibleLead> {
  try {
    return await authorizeLead(userPrincipal(user), leadId, db);
  } catch (error) {
    if (error instanceof DomainNotFoundError) {
      throw new LeadAccessError("Lead not found", 404);
    }
    if (error instanceof DomainAuthorizationError) {
      throw new LeadAccessError("You do not have access to this lead", 403);
    }
    // A database failure is not a refusal. Callers that catch LeadAccessError
    // to answer 403 would otherwise turn an outage into "you do not have
    // access", which is both wrong and impossible to diagnose from the UI.
    throw error;
  }
}
