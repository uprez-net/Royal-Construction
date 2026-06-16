import prisma from "@/lib/prisma";
import { Role, type User } from "@prisma/client";

const INTERNAL_ROLES = new Set<Role>([Role.ADMIN, Role.SITE_MANAGER, Role.GUEST]);

export class LeadAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "LeadAccessError";
  }
}

export type AccessibleLead = {
  id: number;
  assignedId: string | null;
};

export function canAccessLead(
  user: Pick<User, "id" | "role">,
  lead: AccessibleLead,
): boolean {
  return INTERNAL_ROLES.has(user.role) || lead.assignedId === user.id;
}

export async function assertCanAccessLead(
  user: Pick<User, "id" | "role">,
  leadId: number,
): Promise<AccessibleLead> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedId: true },
  });

  if (!lead) {
    throw new LeadAccessError("Lead not found", 404);
  }

  if (!canAccessLead(user, lead)) {
    throw new LeadAccessError("You do not have access to this lead", 403);
  }

  return lead;
}

