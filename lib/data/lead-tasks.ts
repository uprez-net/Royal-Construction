import type { Prisma } from "@prisma/client";
import type { LeadStage, LeadTaskType } from "@prisma/client";

import prisma from "@/lib/prisma";
import { stageMap } from "@/types/lead";
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
      // Mapped, not passed through: the client wants "Discovery", not "DISCOVERY".
      stage: stageMap[t.lead.stage],
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
const CLOSED_STAGES = [
  "CONVERTED",
  "WON",
  "LOST",
  "CANCELLED",
  "DISQUALIFIED",
] as const satisfies readonly LeadStage[];

const LIVE_LEAD = {
  stage: { notIn: [...CLOSED_STAGES] },
} satisfies Prisma.LeadWhereInput;

/**
 * A rule the caller can satisfy, not a server fault.
 *
 * Carried as its own type so the route can answer 409 with the reason instead
 * of a blanket 500 that tells the operator nothing.
 */
export class LeadTaskRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadTaskRejectedError";
  }
}

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

/**
 * Work that has been closed out, newest first.
 *
 * The counterpart to listOpenTasks, and the reason it exists: until this query
 * there was no way to see a task again once it was finished. Completing one
 * removed it from the only list that read tasks at all, so "what did we do on
 * this lead" had no answer and a mis-click was unrecoverable.
 *
 * Same LIVE_LEAD guard as the open list, so a won or lost lead does not drag
 * its history back into a working view.
 */
export async function listCompletedTasks(limit = 100): Promise<LeadTaskRow[]> {
  const rows = await prisma.leadTask.findMany({
    where: { completedAt: { not: null }, lead: LIVE_LEAD },
    select: ROW_SELECT,
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(toRow);
}

export interface CreateLeadTaskInput {
  leadId: number;
  type: LeadTaskType;
  dueDate: Date;
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
      select: { stage: true, assignedId: true, isArchived: true },
    });
    if (!lead) throw new Error(`Lead ${input.leadId} not found`);

    // Refuse work that no list would ever show.
    //
    // The composer had no gate on stage or archive state, so booking a call on
    // a Converted, Lost or archived lead returned a task, rendered a row and
    // popped "Task added." — and then vanished on the next load, because every
    // read path filters through LIVE_LEAD. The row stayed in the database with
    // completedAt null: invisible to every screen, invisible to both reminder
    // crons, and counted by nothing. Better to fail loudly at the point of
    // booking than to accept work and quietly lose it.
    if (lead.isArchived) {
      throw new LeadTaskRejectedError(
        "This lead is archived. Restore it before booking any work.",
      );
    }
    // Widened for the lookup: `includes` on a readonly tuple narrows its
    // argument to the tuple's own members, which would reject any other stage.
    if ((CLOSED_STAGES as readonly LeadStage[]).includes(lead.stage)) {
      throw new LeadTaskRejectedError(
        `This lead is closed as ${stageMap[lead.stage]}. Reopen it before booking any work.`,
      );
    }

    // Stage first, task second. The task row selects its lead, so creating it
    // first would return the stage as it was and every caller would render a
    // lead that had just moved. Callers read task.lead.stage to stay in step.
    const nextStage = resolveLeadStage({ currentStage: lead.stage, taskScheduled: true });
    if (nextStage !== undefined && nextStage !== lead.stage) {
      await tx.lead.update({
        where: { id: input.leadId },
        data: { stage: nextStage, ...closeDatePatch(lead.stage, nextStage, new Date()) },
      });
    }

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

/**
 * Put a closed task back on the list. Deliberately does not touch the lead.
 *
 * Completing was one-way: the task left the only query that read tasks and
 * there was no path back, so closing the wrong row meant re-typing it and
 * losing when it was originally raised. Reopening restores the same row, dates
 * and note.
 *
 * `status` is written back to NEW to keep the column consistent with
 * completedAt. completedAt remains the single source of truth for open vs
 * closed — every query filters on it and nothing reads status — but leaving a
 * reopened row marked DONE would make the column actively misleading to anyone
 * reading the table directly.
 */
export async function reopenLeadTask(taskId: number): Promise<LeadTaskRow | null> {
  // Guarded on completedAt for the same reason completeLeadTask is: two people
  // clicking Reopen is not an error, and the second must not clear a fresh
  // completion recorded in between.
  await prisma.leadTask.updateMany({
    where: { id: taskId, completedAt: { not: null } },
    data: { completedAt: null, status: "NEW" },
  });
  const row = await prisma.leadTask.findUnique({ where: { id: taskId }, select: ROW_SELECT });
  return row ? toRow(row) : null;
}

/**
 * Remove a task outright. For work that should never have been booked.
 *
 * Distinct from completing, and the distinction matters: "Done" asserts the
 * work happened and is what the Completed list, the activity trail and any
 * later reporting will show. Until this existed the only way to clear a
 * mis-typed or duplicated task was to mark it Done, which recorded a call
 * that was never made.
 *
 * Idempotent. A second delete — two people on the same row, or a retried
 * request — reports success rather than a 404 the operator can do nothing
 * about; the row is gone either way, which is what was asked for.
 */
export async function deleteLeadTask(taskId: number): Promise<boolean> {
  const { count } = await prisma.leadTask.deleteMany({ where: { id: taskId } });
  return count > 0;
}

export type { LeadTaskRow };
