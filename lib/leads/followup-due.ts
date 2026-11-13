import type { LeadStage, Prisma } from "@prisma/client";

import { sydneyEndOfDay, sydneyToday } from "@/lib/dates/sydney";

/**
 * Closed leads get no tasks in any list.
 *
 * Thirteen production leads that are won or lost still carry a stale date from
 * the old columns. Without this they would surface as live work the day a
 * screen starts reading tasks.
 */
export const CLOSED_LEAD_STAGES = [
  "CONVERTED",
  "WON",
  "LOST",
  "CANCELLED",
  "DISQUALIFIED",
] as const satisfies readonly LeadStage[];

/**
 * A lead a working view should still show.
 *
 * `isArchived` belongs beside the stage list rather than being bolted on per
 * caller. `createLeadTask` refuses to book work on an archived lead on the
 * grounds that "every read path filters through LIVE_LEAD" — but this clause
 * only ever checked the stage, so a lead archived *after* its task was booked
 * kept that task on the Follow-ups tab and kept both reminder crons emailing
 * about it. The dashboard's own KPI already excluded archived leads, which is
 * how the two disagreed.
 */
export const LIVE_LEAD = {
  stage: { notIn: [...CLOSED_LEAD_STAGES] },
  isArchived: false,
} satisfies Prisma.LeadWhereInput;

/**
 * An open task whose due date has already passed, on a lead a working view
 * still shows.
 *
 * The one definition of "overdue lead task". The office digest the agent reads
 * first, and the agent's office-wide live lookup, both build on it, so
 * "anything overdue?" has one answer whichever path the question takes (#432):
 * a per-lead lookup is deliberately unfiltered by LIVE_LEAD, and an office-wide
 * answer assembled by walking leads picked up a Lost lead's old wait.
 */
export function overdueLeadTaskWhere(
  now: Date,
  assignedId: string | null = null,
): Prisma.LeadTaskWhereInput {
  return {
    completedAt: null,
    dueDate: { lt: now },
    lead: assignedId === null ? LIVE_LEAD : { ...LIVE_LEAD, assignedId },
    status: { not: "DONE" },
  };
}

/**
 * Open work due by the end of today in Sydney — the one definition of a
 * follow-up that is outstanding.
 *
 * Every screen that answers "what is due?" reads `LeadTask`: the Follow-ups
 * tab, the leads table, and both reminder crons. The dashboard was the
 * straggler, still reading `Lead.followupDate` and `Lead.followupCompletedAt`.
 * Those columns cannot answer the question, because nothing clears them: the
 * only writer of `followupCompletedAt` is gated behind an input no UI
 * component sends, so it is null on every lead in the database and the list
 * could never empty. Staging showed 15 leads permanently "overdue" while 14 of
 * them had their follow-up task completed months ago.
 *
 * The comparison is against the end of the Sydney day rather than the instant
 * `now`, because a task due at 9am today is not "not yet due" at 8am — the
 * date is the commitment and the time is a note on it. This is the boundary
 * `followup-lead-reminder` already fires on.
 *
 * Undated tasks are deliberately out. `LeadTask.dueDate` is nullable and null
 * means "no date yet", which is real work but not work due today, and the card
 * renders a countdown badge that has nothing to count from. The Follow-ups tab
 * surfaces them in a bucket of their own.
 */
export function dueFollowUpTaskWhere({
  now = new Date(),
  assignedId,
}: DueFollowUpTaskOptions): Prisma.LeadTaskWhereInput {
  return {
    completedAt: null,
    dueDate: { not: null, lte: sydneyEndOfDay(sydneyToday(now)) },
    lead: assignedId === null ? LIVE_LEAD : { ...LIVE_LEAD, assignedId },
  };
}

export interface DueFollowUpTaskOptions {
  /** The instant to measure "today" from. Defaults to now. */
  now?: Date;
  /**
   * Restrict to leads assigned to this application user, or `null` for every
   * live lead.
   *
   * Required, with no default, and that is the safety property: forgetting the
   * scope is a compile error rather than a silent unscoped read. `null` has to
   * be written out, so "every live lead" is always a decision somebody made on
   * purpose and a reviewer can see.
   *
   * This is `leadListScope(user).assignedId` — the same rule `canAccessLead`
   * applies one lead at a time, pushed into the query. Internal roles get
   * `null` and read the whole business, which is what the dashboard is for and
   * what every other KPI beside it already does. Anyone else is held to their
   * own leads, and that is not optional: `proxy.ts` only turns away
   * unauthenticated and GUEST users, so a CUSTOMER can reach the dashboard,
   * and this list carries lead names, locations, task notes and lead notes.
   *
   * Taken as a plain id rather than importing `leadListScope` so this module
   * keeps no edge to `lib/offer/access.ts`, which pulls in the Prisma client —
   * `lib/domain/leads/tasks.ts` imports this file and is bundled into the eve
   * agent. The caller resolves the scope; this only applies it.
   */
  assignedId: string | null;
}
