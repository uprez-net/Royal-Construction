import type { LeadTaskType, Prisma } from "@prisma/client";

/**
 * The task types that count as a lead's "follow-up": the next call, email or
 * WhatsApp message to the client (#316).
 *
 * A MEETING is a booked site visit or consultation, which the meeting reminders
 * own, and WAITING is a deliberate hold: neither is a follow-up, and showing a
 * booked meeting as "next follow-up" put a different date in the Follow-up cell
 * than the call that was actually due. Everything that selects or displays a
 * follow-up reads this list: the lead row, the follow-up filters and the stats.
 */
export const FOLLOWUP_TASK_TYPES = [
  "CALL",
  "EMAIL",
  "WHATSAPP",
] as const satisfies readonly LeadTaskType[];

/**
 * The one task that decides a lead's follow-up date.
 *
 * Deliberately NOT filtered to open work. The filter used to be
 * `where: { completedAt: null }`, which made a completed task come back as an
 * empty array — indistinguishable from a lead that never had a task at all.
 * The resolver below needs to tell those two apart, so the row has to survive
 * the query for it to look at.
 *
 * Only follow-up types (FOLLOWUP_TASK_TYPES), so a booked meeting never answers
 * for a follow-up.
 *
 * The ordering does the work instead: open tasks first (`completedAt` null),
 * then soonest due, then oldest. So `take: 1` yields the next open task when
 * there is one, and otherwise the earliest-closed task as evidence that the
 * follow-up has already happened.
 */
export const NEXT_FOLLOWUP_TASK = {
  where: { type: { in: [...FOLLOWUP_TASK_TYPES] } },
  orderBy: [
    { completedAt: { sort: "asc", nulls: "first" } },
    { dueDate: { sort: "asc", nulls: "last" } },
    { id: "asc" },
  ],
  take: 1,
  select: { dueDate: true, dueTime: true, completedAt: true },
} satisfies Prisma.Lead$tasksArgs;

/** What the query above returns, and the only shape the resolver accepts. */
export type NextFollowupTask = {
  dueDate: Date | null;
  dueTime: string | null;
  completedAt: Date | null;
};

/**
 * A lead's next follow-up, or nothing.
 *
 * Three states, and the bug was that the old code could only see two of them:
 *
 *   an open task exists      -> its date. The task is the source of truth.
 *   only completed tasks     -> NOTHING is upcoming. This is the fix.
 *   no task has ever existed -> the retired `Lead.followupDate` column.
 *
 * "No task has ever existed" means no task of ANY type. A lead whose only tasks
 * are a meeting or a hold has moved to tasks and has no follow-up, rather than
 * resurfacing a stale column (#316): `anyTaskCount` carries that, and defaults
 * to the follow-up list's own length for callers that cannot say.
 *
 * The middle case used to fall through to the column, and that column is never
 * cleared — its companion `Lead.followupCompletedAt` has exactly one writer,
 * gated behind an input no UI component sends, and is null on every lead in
 * the database. So completing a follow-up left the original date standing, and
 * it was shown in the app, emailed to the client and written into the export.
 * On staging that was 14 leads carrying dates 6 to 222 days stale.
 *
 * The legacy branch is kept rather than deleted because it cannot be measured
 * away: staging has no lead in that state (all 16 with a date also have a task,
 * backfilled from the column in one batch), but production is not staging and
 * the column predates the task table. Keeping it costs nothing and blanking a
 * real date would be a worse bug than the one being fixed.
 */
export function resolveFollowup(
  tasks: readonly NextFollowupTask[],
  legacyDate: Date | null,
  legacyTime: string | null,
  anyTaskCount: number = tasks.length,
): { date: Date | null; time: string | null } {
  const task = tasks[0];

  // Never had a task of any kind: the column is all there is.
  if (!task && anyTaskCount === 0) {
    return { date: legacyDate, time: legacyTime ?? null };
  }

  // Has tasks, but none of them a follow-up (a meeting, a hold): nothing to
  // follow up, and the retired column is not consulted.
  if (!task) return { date: null, time: null };

  // The follow-up happened. There is no next one until somebody books it, and
  // saying so is the entire point — the alternative is the stale date.
  if (task.completedAt !== null) return { date: null, time: null };

  // An open task with no due date is real work deliberately left unscheduled.
  // Falling back to the column here would print a stale legacy date over a
  // live task, which is worse than showing nothing.
  return { date: task.dueDate, time: task.dueTime };
}
