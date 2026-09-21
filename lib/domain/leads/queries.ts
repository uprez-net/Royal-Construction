import type { LeadStage, LeadTaskStatus, LeadTaskType } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeLead, leadListScope } from "../access/leads";

// Lead reads, scoped by the one lead rule.
//
// Shaped as domain records, not as either caller's presentation: the app wants
// `UiLead` with a display stage, Eve wants an envelope with untrusted text
// bounded. Both of those are the adapter's job. What has to be shared is which
// rows come back and who may see them — which is where a second listing query
// with a slightly different scope would do the damage.

export type LeadSummary = {
  readonly id: number;
  readonly name: string;
  readonly stage: LeadStage;
  readonly location: string | null;
  readonly type: string[];
  readonly isArchived: boolean;
  readonly updatedAt: Date;
};

export type SearchLeadsInput = {
  readonly query: string;
  readonly limit: number;
  readonly includeArchived: boolean;
};

/**
 * Leads matching a free-text query, within the caller's scope.
 *
 * The scope is `leadListScope`, the same rule `authorizeLead` applies per
 * record — so a row that appears here always opens.
 */
export async function searchLeads(
  principal: DomainPrincipal,
  input: SearchLeadsInput,
  db: DomainDb,
): Promise<LeadSummary[]> {
  const scope = leadListScope(principal);
  const query = input.query.trim();

  return db.lead.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      isArchived: true,
      location: true,
      name: true,
      stage: true,
      type: true,
      updatedAt: true,
    },
    take: input.limit,
    where: {
      ...(scope.assignedId === null ? {} : { assignedId: scope.assignedId }),
      ...(input.includeArchived ? {} : { isArchived: false }),
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { location: { contains: query, mode: "insensitive" } },
      ],
    },
  });
}

export type LeadHistoryEntry = {
  readonly action: string;
  readonly detail: string;
  readonly type: string;
  readonly actionDate: Date;
  readonly authorName: string | null;
};

export type LeadDetail = {
  readonly id: number;
  readonly name: string;
  readonly stage: LeadStage;
  readonly location: string | null;
  readonly type: string[];
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly estimatedValue: string | null;
  readonly expectedCloseDate: Date | null;
  readonly assignedUser: { id: string; name: string } | null;
  readonly primaryContact: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  readonly secondaryContact: {
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  /**
   * Operator- and customer-authored text. Every adapter must treat it as data:
   * Eve bounds it and flags it, the app renders it as text. Carried as a
   * separate field so an adapter cannot forget which parts are untrusted.
   */
  readonly history: readonly LeadHistoryEntry[];
};

/**
 * One lead with its recent history, for a caller permitted to read it.
 *
 * `estimatedValue` is stringified here rather than handed over as a Prisma
 * Decimal: a Decimal does not survive a Server Action's serialization or an
 * Eve envelope, and rounding it at the boundary is how a quoted figure drifts.
 */
export async function getLeadDetail(
  principal: DomainPrincipal,
  leadId: number,
  historyLimit: number,
  db: DomainDb,
): Promise<LeadDetail> {
  await authorizeLead(principal, leadId, db);

  const lead = await db.lead.findUnique({
    select: {
      assignedUser: { select: { id: true, name: true } },
      createdAt: true,
      email: true,
      estimatedValue: true,
      expectedCloseDate: true,
      history: {
        orderBy: { actionDate: "desc" },
        select: {
          action: true,
          actionDate: true,
          author: { select: { name: true } },
          detail: true,
          type: true,
        },
        take: historyLimit,
      },
      id: true,
      isArchived: true,
      location: true,
      name: true,
      phone: true,
      secondaryEmail: true,
      secondaryName: true,
      secondaryPhone: true,
      stage: true,
      type: true,
      updatedAt: true,
    },
    where: { id: leadId },
  });

  // Authorized a moment ago, so this is a genuine race (an archive-and-delete
  // between the two reads), not a permission problem.
  if (!lead) throw new DomainNotFoundError("Lead not found");

  return {
    assignedUser: lead.assignedUser,
    createdAt: lead.createdAt,
    estimatedValue: lead.estimatedValue?.toString() ?? null,
    expectedCloseDate: lead.expectedCloseDate,
    history: lead.history.map((entry) => ({
      action: entry.action,
      actionDate: entry.actionDate,
      authorName: entry.author?.name ?? null,
      detail: entry.detail,
      type: entry.type,
    })),
    id: lead.id,
    isArchived: lead.isArchived,
    location: lead.location,
    name: lead.name,
    primaryContact: { email: lead.email, name: lead.name, phone: lead.phone },
    secondaryContact: lead.secondaryName
      ? {
          email: lead.secondaryEmail,
          name: lead.secondaryName,
          phone: lead.secondaryPhone,
        }
      : null,
    stage: lead.stage,
    type: lead.type,
    updatedAt: lead.updatedAt,
  };
}

export type LeadTaskState = "all" | "completed" | "open";

export type LeadTaskSummary = {
  readonly id: number;
  readonly type: LeadTaskType;
  readonly status: LeadTaskStatus;
  readonly dueDate: Date | null;
  readonly dueTime: string | null;
  /** Operator-authored. Untrusted, like lead history. */
  readonly notes: string | null;
  readonly completedAt: Date | null;
};

/**
 * One lead's tasks, open, completed or both.
 *
 * Distinct from `listOpenTasks` in ./tasks.ts, which answers "open work across
 * every live lead" for the Follow-ups tab and is bounded by that. This one is
 * already bounded by naming a single lead, and deliberately does not apply the
 * LIVE_LEAD filter: asking a closed lead what was done on it is a fair
 * question, where showing its work in a live worklist is not.
 */
export async function listLeadTasks(
  principal: DomainPrincipal,
  input: { leadId: number; limit: number; state: LeadTaskState },
  db: DomainDb,
): Promise<LeadTaskSummary[]> {
  await authorizeLead(principal, input.leadId, db);

  const completedAt =
    input.state === "open"
      ? { equals: null }
      : input.state === "completed"
        ? { not: null }
        : undefined;

  return db.leadTask.findMany({
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: {
      completedAt: true,
      dueDate: true,
      dueTime: true,
      id: true,
      notes: true,
      status: true,
      type: true,
    },
    take: input.limit,
    where: {
      leadId: input.leadId,
      ...(completedAt === undefined ? {} : { completedAt }),
    },
  });
}
