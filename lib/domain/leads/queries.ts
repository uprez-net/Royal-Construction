import type {
  LeadStage,
  LeadTaskStatus,
  LeadTaskType,
  Prisma,
} from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeLead, leadListScope } from "../access/leads";
import { leadListOrderBy } from "./list-sort";
import { overdueLeadTaskWhere } from "@/lib/leads/followup-due";

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
  /** Free text over name, email, phone and location; empty lists every lead. */
  readonly query: string;
  /** Rows per page. */
  readonly limit: number;
  /** 1-based. */
  readonly page: number;
  readonly includeArchived: boolean;
  /** Only these stages; empty or absent means every stage. */
  readonly stages?: readonly LeadStage[];
};

export type SearchLeadsResult = {
  readonly items: LeadSummary[];
  /** Every lead the filters match, across all pages. */
  readonly totalCount: number;
  /**
   * How many leads match the scope, archive filter and query in each stage —
   * deliberately ignoring `stages`, so one call answers "what does the
   * pipeline look like" even while a stage filter narrows the rows.
   */
  readonly countsByStage: Partial<Record<LeadStage, number>>;
};

/**
 * Leads matching a free-text query, within the caller's scope, a page at a
 * time, with the total the filters match.
 *
 * The scope is `leadListScope`, the same rule `authorizeLead` applies per
 * record — so a row that appears here always opens. The page, the total and
 * the stage counts are three reads of one `where`, so they cannot disagree
 * about which leads are in it.
 *
 * Ordered by creation, newest first, with the id tie-breaker the app's lead
 * list uses: a lead edited while someone pages through does not move, so no
 * row is skipped between pages.
 */
export async function searchLeads(
  principal: DomainPrincipal,
  input: SearchLeadsInput,
  db: DomainDb,
): Promise<SearchLeadsResult> {
  const scope = leadListScope(principal);
  const query = input.query.trim();
  const base: Prisma.LeadWhereInput = {
    ...(scope.assignedId === null ? {} : { assignedId: scope.assignedId }),
    ...(input.includeArchived ? {} : { isArchived: false }),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { location: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const where: Prisma.LeadWhereInput = input.stages?.length
    ? { ...base, stage: { in: [...input.stages] } }
    : base;

  const [items, totalCount, stageGroups] = await Promise.all([
    db.lead.findMany({
      orderBy: leadListOrderBy(),
      select: {
        id: true,
        isArchived: true,
        location: true,
        name: true,
        stage: true,
        type: true,
        updatedAt: true,
      },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      where,
    }),
    db.lead.count({ where }),
    db.lead.groupBy({ by: ["stage"], _count: { _all: true }, where: base }),
  ]);

  return {
    items,
    totalCount,
    countsByStage: Object.fromEntries(
      stageGroups.map((group) => [group.stage, group._count._all]),
    ),
  };
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

export type OverdueLeadTask = {
  readonly id: number;
  readonly leadId: number;
  readonly leadName: string;
  readonly leadStage: LeadStage;
  readonly type: LeadTaskType;
  readonly dueDate: Date;
  readonly dueTime: string | null;
  /** Operator-authored. Untrusted, like lead history. */
  readonly notes: string | null;
};

/**
 * Open lead tasks past their due date across the office, oldest first.
 *
 * Built on `overdueLeadTaskWhere`, which the office digest and the lead-tools
 * rule share: closed and archived leads are not work. `listLeadTasks` below
 * does NOT apply it, because asking about one named lead is a different
 * question — so an office-wide "anything overdue?" must come from here, never
 * from walking leads and listing each one's tasks (#432).
 *
 * `total` counts every overdue task, so a capped list can say how many more
 * there are rather than reading as complete.
 */
export async function listOverdueLeadTasks(
  principal: DomainPrincipal,
  input: { limit: number },
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ total: number; tasks: OverdueLeadTask[] }> {
  const scope = leadListScope(principal);
  const where = overdueLeadTaskWhere(now, scope.assignedId);
  const [total, rows] = await Promise.all([
    db.leadTask.count({ where }),
    db.leadTask.findMany({
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: {
        dueDate: true,
        dueTime: true,
        id: true,
        lead: { select: { id: true, name: true, stage: true } },
        notes: true,
        type: true,
      },
      take: input.limit,
      where,
    }),
  ]);
  return {
    tasks: rows.flatMap((row) =>
      row.dueDate
        ? [
            {
              dueDate: row.dueDate,
              dueTime: row.dueTime,
              id: row.id,
              leadId: row.lead.id,
              leadName: row.lead.name,
              leadStage: row.lead.stage,
              notes: row.notes,
              type: row.type,
            },
          ]
        : [],
    ),
    total,
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
