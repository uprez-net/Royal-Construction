import { TradieScheduleStatus } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeProject } from "../access/projects";

// Booking a tradie onto a project.
//
// Two implementations, and this time it was the APP that was missing the
// rules:
//
//   - No overlap check. lib/data/tradieSchedules.ts#createTradieSchedule wrote
//     the row unconditionally, so the same tradie could be booked onto two
//     projects for the same week. Eve refused it. A tradie who cannot show up
//     to one of two sites is a day of work lost on whichever site loses, and
//     nothing in the app would have warned anyone.
//   - No check that the milestone belongs to the project. Both ids arrive from
//     the client, so a booking could be attached to a milestone on somebody
//     else's project. Eve checked; the app did not.
//
// Both are kept, and both now apply to both callers. This is a deliberate
// behaviour change on the app side: a booking that overlaps an existing active
// one is now refused where it used to be written. If the office genuinely
// needs to double-book a tradie with a crew across two sites, that wants an
// explicit override, not a missing check.

export type CreateScheduleInput = {
  readonly tradieId: string;
  readonly projectId: string;
  readonly milestoneId?: string | null;
  readonly scheduledDate: Date;
  readonly durationDays: number;
  readonly requiresQuote: boolean;
};

/**
 * Statuses that still hold the tradie's time.
 *
 * A declined booking was never accepted and a completed one is in the past, so
 * neither blocks a new one.
 */
const BLOCKING_STATUSES = [
  TradieScheduleStatus.DECLINED,
  TradieScheduleStatus.COMPLETED,
];

/**
 * Refuse a booking that overlaps one this tradie already holds.
 *
 * Half-open by day: a booking that ends on the morning a new one starts does
 * not block it. The candidate set is narrowed in the query by start date and
 * the end date is computed per row, because `durationDays` varies and the
 * database has no end column to compare.
 */
export async function assertNoScheduleConflict(
  input: {
    tradieId: string;
    scheduledDate: Date;
    durationDays: number;
    /** An existing booking being moved, which must not conflict with itself. */
    ignoreScheduleId?: string;
  },
  db: DomainDb,
): Promise<void> {
  const end = new Date(input.scheduledDate);
  end.setUTCDate(end.getUTCDate() + input.durationDays);

  const candidates = await db.tradieSchedule.findMany({
    select: { durationDays: true, id: true, scheduledDate: true },
    where: {
      id: input.ignoreScheduleId ? { not: input.ignoreScheduleId } : undefined,
      scheduledDate: { lt: end },
      status: { notIn: BLOCKING_STATUSES },
      tradieId: input.tradieId,
    },
  });

  const conflict = candidates.find((candidate) => {
    const candidateEnd = new Date(candidate.scheduledDate);
    candidateEnd.setUTCDate(candidateEnd.getUTCDate() + candidate.durationDays);
    return candidateEnd > input.scheduledDate;
  });

  if (conflict) {
    throw new DomainTransitionError(
      "That tradie already has an overlapping active booking in the requested window.",
    );
  }
}

/**
 * Assert the milestone named alongside a project actually belongs to it.
 *
 * Both ids come from outside. Without this a booking lands on a milestone the
 * caller has no claim to, and the project screens then show work nobody
 * scheduled.
 */
export async function assertMilestoneOnProject(
  projectId: string,
  milestoneId: string,
  db: DomainDb,
): Promise<void> {
  const milestone = await db.milestone.findFirst({
    select: { id: true },
    where: { id: milestoneId, projectId },
  });
  if (!milestone) {
    throw new DomainValidationError(
      "Milestone does not belong to the selected project.",
      "milestoneId",
    );
  }
}

export type CreatedSchedule = {
  readonly id: string;
  readonly tradieId: string;
  readonly projectId: string;
  readonly milestoneId: string | null;
  readonly scheduledDate: Date;
  readonly durationDays: number;
  readonly status: TradieScheduleStatus;
  readonly requiresQuote: boolean;
};

/**
 * Book a tradie, with every check both callers should always have had.
 *
 * Returns the bare record. Notifications, activity-log entries and cache
 * expiry belong to the adapter — the app fires them in `after()`, Eve records
 * its own audit — and none of them is a business rule.
 */
export async function createTradieSchedule(
  principal: DomainPrincipal,
  input: CreateScheduleInput,
  db: DomainDb,
): Promise<CreatedSchedule> {
  const project = await authorizeProject(principal, input.projectId, db);

  const tradie = await db.tradie.findUnique({
    select: { id: true },
    where: { id: input.tradieId },
  });
  if (!tradie) throw new DomainNotFoundError("Tradie not found");

  if (input.milestoneId) {
    await assertMilestoneOnProject(project.id, input.milestoneId, db);
  }

  await assertNoScheduleConflict(
    {
      durationDays: input.durationDays,
      scheduledDate: input.scheduledDate,
      tradieId: tradie.id,
    },
    db,
  );

  const created = await db.tradieSchedule.create({
    data: {
      durationDays: input.durationDays,
      milestoneId: input.milestoneId ?? null,
      projectId: project.id,
      requiresQuote: input.requiresQuote,
      scheduledDate: input.scheduledDate,
      status: input.requiresQuote
        ? TradieScheduleStatus.AWAITING_QUOTE
        : TradieScheduleStatus.PENDING,
      tradieId: tradie.id,
    },
    select: {
      durationDays: true,
      id: true,
      milestoneId: true,
      projectId: true,
      requiresQuote: true,
      scheduledDate: true,
      status: true,
      tradieId: true,
    },
  });

  return created;
}
