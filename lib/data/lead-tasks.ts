import type { Prisma } from "@prisma/client";
import type { LeadTaskType } from "@prisma/client";

import prisma from "@/lib/prisma";
import type { LeadTaskRow } from "@/lib/leads/task-types";
import { closeDatePatch } from "@/lib/leads/pipeline-stages";
import { resolveLeadStage } from "@/lib/leads/resolve-stage";

const ROW_SELECT = {
  id: true,
  leadId: true,
  type: true,
  status: true,
  dueDate: true,
  dueTime: true,
  notes: true,
  completedAt: true,
  lead: {
    select: {
      id: true,
      name: true,
      stage: true,
      phone: true,
      email: true,
      assignedUser: { select: { name: true } },
    },
  },
} satisfies Prisma.LeadTaskSelect;

type RawRow = Prisma.LeadTaskGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(t: RawRow): LeadTaskRow {
  return {
    id: t.id,
    leadId: t.leadId,
    type: t.type,
    status: t.status,
    dueDate: t.dueDate?.toISOString() ?? null,
    dueTime: t.dueTime,
    notes: t.notes,
    completedAt: t.completedAt?.toISOString() ?? null,
    lead: {
      id: t.lead.id,
      name: t.lead.name,
      stage: t.lead.stage,
      phone: t.lead.phone,
      email: t.lead.email,
      assignedName: t.lead.assignedUser?.name ?? null,
    },
  };
}

/**
 * Closed leads get no tasks in any list.
 *
 * Thirteen production leads that are won or lost still carry a stale date from
 * the old columns. Without this they would surface as live work the day the
 * tab starts reading tasks.
 */
const LIVE_LEAD = {
  stage: { notIn: ["CONVERTED", "WON", "LOST", "CANCELLED", "DISQUALIFIED"] },
} satisfies Prisma.LeadWhereInput;

/** Open work across every stage. The stage is shown, never used to filter. */
export async function listOpenTasks(limit = 200): Promise<LeadTaskRow[]> {
  const rows = await prisma.leadTask.findMany({
    where: { completedAt: null, lead: LIVE_LEAD },
    select: ROW_SELECT,
    // Undated tasks last: they are real work with no date yet, not overdue.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: limit,
  });
  return rows.map(toRow);
}

export interface CreateLeadTaskInput {
  leadId: number;
  type: LeadTaskType;
  dueDate: Date | null;
  dueTime?: string | null;
  notes?: string | null;
  assignedId?: string | null;
}

/**
 * Create a task, and advance the lead only if it has not reached Discovery.
 *
 * The stage write is the ONE thing a task is allowed to do to a lead, and it is
 * strictly forward: a lead at Qualified or beyond keeps its stage, and a closed
 * lead is not dragged open by someone booking a call.
 */
export async function createLeadTask(input: CreateLeadTaskInput): Promise<LeadTaskRow> {
  // One transaction. The task row and the stage move are one decision: if the
  // second write failed on its own, the lead would carry work it never
  // advanced for, and nothing would ever retry it.
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: { stage: true, assignedId: true },
    });
    if (!lead) throw new Error(`Lead ${input.leadId} not found`);

    const created = await tx.leadTask.create({
      data: {
        leadId: input.leadId,
        type: input.type,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        notes: input.notes?.trim() || null,
        assignedId: input.assignedId ?? lead.assignedId,
      },
      select: ROW_SELECT,
    });

    const nextStage = resolveLeadStage({ currentStage: lead.stage, taskScheduled: true });
    if (nextStage !== undefined && nextStage !== lead.stage) {
      await tx.lead.update({
        where: { id: input.leadId },
        data: { stage: nextStage, ...closeDatePatch(lead.stage, nextStage, new Date()) },
      });
    }

    return toRow(created);
  });
}

/**
 * Close a task. Deliberately does not touch the lead.
 *
 * This is the line that used to write CONTACTED, which is why 6 of the 11
 * Contacted leads on production are there and why no lead that ever finished a
 * follow-up sat above Contacted.
 */
export async function completeLeadTask(taskId: number): Promise<LeadTaskRow | null> {
  const updated = await prisma.leadTask.updateMany({
    where: { id: taskId, completedAt: null },
    data: { completedAt: new Date(), status: "DONE" },
  });
  if (updated.count === 0) {
    // Already closed, or gone. Not an error: two people clicking Done is fine.
    const existing = await prisma.leadTask.findUnique({ where: { id: taskId }, select: ROW_SELECT });
    return existing ? toRow(existing) : null;
  }
  const row = await prisma.leadTask.findUnique({ where: { id: taskId }, select: ROW_SELECT });
  return row ? toRow(row) : null;
}

export type { LeadTaskRow };
