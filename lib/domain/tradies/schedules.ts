import {
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieScheduleStatus,
} from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { authorizeProject } from "../access/projects";
import {
  normalizeQuoteBasis,
  parseQuotedAmount,
  scheduleTotalCost,
} from "../../../utils/calculations";
import { currency } from "../../../utils/formatters";

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

/**
 * Create a batch atomically. The App bulk endpoint used to bypass the single
 * booking command entirely, so it skipped milestone ownership and overlap
 * checks. Running the same command once per row inside one transaction keeps
 * those checks identical and makes a partial bulk booking impossible.
 */
export async function createTradieSchedules(
  principal: DomainPrincipal,
  inputs: readonly CreateScheduleInput[],
  db: DomainDb,
): Promise<CreatedSchedule[]> {
  if (inputs.length === 0) {
    throw new DomainValidationError(
      "No schedules were provided for bulk creation.",
    );
  }
  const run = async (transactionDb: DomainDb) => {
    const created: CreatedSchedule[] = [];
    for (const input of inputs) {
      created.push(await createTradieSchedule(principal, input, transactionDb));
    }
    return created;
  };
  return "$transaction" in db ? db.$transaction(run) : run(db);
}

const ALLOWED_TRANSITIONS: Record<
  TradieScheduleStatus,
  readonly TradieScheduleStatus[]
> = {
  [TradieScheduleStatus.PENDING]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.NO_RESPONSE,
    TradieScheduleStatus.PENDING_RESPONSE,
  ],
  [TradieScheduleStatus.AWAITING_QUOTE]: [
    TradieScheduleStatus.PENDING_RESPONSE,
    TradieScheduleStatus.NO_RESPONSE,
  ],
  [TradieScheduleStatus.PENDING_RESPONSE]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.QUOTE_RECEIVED]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.AWAITING_ADMIN_APPROVAL]: [
    TradieScheduleStatus.CONFIRMED,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.CONFIRMED]: [
    TradieScheduleStatus.COMPLETED,
    TradieScheduleStatus.DECLINED,
    TradieScheduleStatus.CONFIRMED,
  ],
  [TradieScheduleStatus.PENDING_FINAL_CONFIRMATION]: [
    TradieScheduleStatus.CONFIRMED,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.NO_RESPONSE]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.DECLINED]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.PENDING_RESPONSE,
    TradieScheduleStatus.NO_RESPONSE,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.COMPLETED]: [],
};

type ScheduleQuoteInput = {
  readonly quote?: string | null;
  readonly quoteUnit?: "FIXED" | "HOURLY" | "DAILY";
};

type ScheduleMutationResult = {
  readonly scheduleId: string;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: TradieScheduleStatus;
  readonly previousStatus?: TradieScheduleStatus;
  readonly scheduledDate: Date;
  readonly durationDays: number;
  readonly quotedPrice: string | null;
  readonly approvalId?: string;
};

/** Move one booking through the persisted state machine and quote rule. */
export async function transitionTradieSchedule(
  principal: DomainPrincipal,
  input: {
    scheduleId: string;
    toStatus: TradieScheduleStatus;
    /** App approval side effects may run after the state transition. */
    statusAlreadyApplied?: boolean;
    /**
     * The status that was actually committed, when it differs from the one
     * whose side effects the caller wants.
     *
     * Approving a booking writes PENDING_FINAL_CONFIRMATION — the reminder job
     * is what moves it to CONFIRMED a week out — but the notification the site
     * manager needs is the CONFIRMED one. Checking `toStatus` here meant that
     * call always threw, so approving a booking committed the decision and
     * then silently told nobody. Pre-dates this branch; the rule lives here
     * now, so it is fixed here.
     */
    appliedStatus?: TradieScheduleStatus;
  } & ScheduleQuoteInput,
  db: DomainDb,
): Promise<ScheduleMutationResult> {
  const existing = await findSchedule(input.scheduleId, db);
  await authorizeProject(principal, existing.projectId, db);

  if (
    input.statusAlreadyApplied &&
    existing.status !== (input.appliedStatus ?? input.toStatus)
  ) {
    throw new DomainTransitionError(
      "This schedule changed before its approval side effects completed.",
    );
  }
  if (
    !input.statusAlreadyApplied &&
    !ALLOWED_TRANSITIONS[existing.status].includes(input.toStatus)
  ) {
    throw new DomainTransitionError(
      `Invalid schedule transition from ${existing.status} to ${input.toStatus}.`,
      existing.status,
      input.toStatus,
    );
  }

  const normalized = input.statusAlreadyApplied
    ? null
    : readQuote(input.quote, input.quoteUnit);
  if (!input.statusAlreadyApplied) {
    const updatedCount = await db.tradieSchedule.updateMany({
      data: {
        status: input.toStatus,
        ...(input.toStatus === TradieScheduleStatus.CONFIRMED &&
        existing.status !== TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
          ? { reminderSentAt: null }
          : {}),
        ...(normalized
          ? {
              quotedPrice: scheduleTotalCost(
                normalized.amount,
                existing.durationDays,
                normalized.unit,
              ).toFixed(2),
              requiresQuote: true,
            }
          : {}),
      },
      where: { id: existing.id, status: existing.status },
    });
    if (updatedCount.count !== 1) {
      throw new DomainTransitionError(
        "The schedule changed before this transition was applied.",
      );
    }

    if (
      input.toStatus === TradieScheduleStatus.DECLINED &&
      existing.status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
    ) {
      await db.tradieApproval.updateMany({
        where: {
          actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
          status: TradieApprovalStatus.PENDING,
          tradieId: existing.tradieId,
          updationData: { path: ["scheduleId"], equals: existing.id },
        },
        data: {
          rejectionReason: "Tradie declined the job.",
          status: TradieApprovalStatus.REJECTED,
        },
      });
    }
  }

  if (normalized) {
    await db.tradie.update({
      data: {
        lastQuotedPrice: normalized.amount,
        lastQuotedPriceUnit: normalized.unit,
      },
      where: { id: existing.tradieId },
    });
  }

  let approvalId: string | undefined;
  if (
    !input.statusAlreadyApplied &&
    input.toStatus === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
  ) {
    const requesterId = attributionUserId(principal);
    if (!requesterId) {
      throw new DomainAuthorizationError(
        "Schedule approval requires a signed-in user.",
      );
    }
    const totalCost = scheduleTotalCost(
      parseFloat(existing.tradie.lastQuotedPrice?.toString() ?? "0"),
      existing.durationDays,
      existing.tradie.lastQuotedPriceUnit,
    );
    const cost = currency.format(
      existing.quotedPrice
        ? parseFloat(existing.quotedPrice)
        : normalized
          ? scheduleTotalCost(
              normalized.amount,
              existing.durationDays,
              normalized.unit,
            )
          : totalCost,
    );
    const approval = await db.tradieApproval.create({
      data: {
        actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
        reason: `${existing.tradie.name} has confirmed their availability for the scheduled task on ${existing.scheduledDate.toISOString().slice(0, 10)}. Please review and approve the booking.`,
        requestedBy: requesterId,
        tradieId: existing.tradieId,
        updationData: {
          cost,
          durationDays: existing.durationDays,
          milestoneId: existing.milestoneId ?? undefined,
          milestoneName: existing.milestone?.name ?? "General Task",
          projectId: existing.projectId,
          projectName: existing.project.name,
          scheduleId: existing.id,
          scheduledDate: existing.scheduledDate.toISOString(),
        },
      },
      select: { id: true },
    });
    approvalId = approval.id;
  }

  return {
    durationDays: existing.durationDays,
    previousStatus: input.statusAlreadyApplied ? undefined : existing.status,
    projectId: existing.projectId,
    projectName: existing.project.name,
    quotedPrice: normalized
      ? scheduleTotalCost(
          normalized.amount,
          existing.durationDays,
          normalized.unit,
        ).toFixed(2)
      : existing.quotedPrice,
    scheduleId: existing.id,
    scheduledDate: existing.scheduledDate,
    status: input.toStatus,
    tradieId: existing.tradieId,
    tradieName: existing.tradie.name,
    ...(approvalId ? { approvalId } : {}),
  };
}

/** Reschedule one booking with an optimistic old-date/duration check. */
export async function rescheduleTradieSchedule(
  principal: DomainPrincipal,
  input: {
    scheduleId: string;
    scheduledDate: Date;
    durationDays?: number;
    milestoneId?: string | null;
  },
  db: DomainDb,
): Promise<ScheduleMutationResult> {
  const existing = await findSchedule(input.scheduleId, db);
  await authorizeProject(principal, existing.projectId, db);
  const durationDays = input.durationDays ?? existing.durationDays;
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new DomainValidationError(
      "A schedule must last at least one day.",
      "durationDays",
    );
  }
  if (Number.isNaN(input.scheduledDate.getTime())) {
    throw new DomainValidationError("The scheduled date is invalid.", "scheduledDate");
  }
  if (input.milestoneId) {
    await assertMilestoneOnProject(existing.projectId, input.milestoneId, db);
  }
  await assertNoScheduleConflict(
    {
      durationDays,
      ignoreScheduleId: existing.id,
      scheduledDate: input.scheduledDate,
      tradieId: existing.tradieId,
    },
    db,
  );

  const updatedCount = await db.tradieSchedule.updateMany({
    data: {
      durationDays,
      ...(input.milestoneId !== undefined
        ? { milestoneId: input.milestoneId }
        : {}),
      scheduledDate: input.scheduledDate,
    },
    where: {
      durationDays: existing.durationDays,
      id: existing.id,
      scheduledDate: existing.scheduledDate,
    },
  });
  if (updatedCount.count !== 1) {
    throw new DomainTransitionError(
      "The schedule changed before it could be rescheduled.",
    );
  }

  return {
    durationDays,
    projectId: existing.projectId,
    projectName: existing.project.name,
    quotedPrice: existing.quotedPrice,
    scheduleId: existing.id,
    scheduledDate: input.scheduledDate,
    status: existing.status,
    tradieId: existing.tradieId,
    tradieName: existing.tradie.name,
  };
}

/** Queue deletion; the booking remains until an admin resolves the request. */
export async function requestTradieScheduleDeletion(
  principal: DomainPrincipal,
  input: { scheduleId: string; reason: string },
  db: DomainDb,
): Promise<{
  approvalId: string;
  scheduleId: string;
  status: TradieScheduleStatus;
  tradieId: string;
  tradieName: string;
  tradieTrade: string;
  projectId: string;
  projectName: string;
}> {
  const schedule = await findSchedule(input.scheduleId, db);
  await authorizeProject(principal, schedule.projectId, db);
  const requesterId = attributionUserId(principal);
  if (!requesterId) {
    throw new DomainAuthorizationError(
      "Requesting schedule deletion needs a signed-in user.",
    );
  }
  if (!input.reason.trim()) {
    throw new DomainValidationError("A deletion reason is required.", "reason");
  }

  const existing = await db.tradieApproval.findFirst({
    select: { id: true },
    where: {
      actionType: TradieApprovalActionType.SCHEDULE_DELETION,
      pendingDeletionKey: schedule.id,
      status: TradieApprovalStatus.PENDING,
    },
  });
  if (existing) {
    throw new DomainTransitionError(
      "A deletion request for this schedule is already pending.",
    );
  }

  const totalCost = scheduleTotalCost(
    parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
    schedule.durationDays,
    schedule.tradie.lastQuotedPriceUnit,
  );
  const cost = currency.format(
    schedule.quotedPrice ? parseFloat(schedule.quotedPrice) : totalCost,
  );
  const approval = await db.tradieApproval.create({
    data: {
      actionType: "SCHEDULE_DELETION",
      pendingDeletionKey: schedule.id,
      reason: input.reason.trim(),
      requestedBy: requesterId,
      tradieId: schedule.tradieId,
      updationData: {
        currentStatus: schedule.status,
        cost,
        durationDays: schedule.durationDays,
        milestoneId: schedule.milestoneId ?? undefined,
        milestoneName: schedule.milestone?.name ?? "General Task",
        projectId: schedule.projectId,
        projectName: schedule.project.name,
        scheduleId: schedule.id,
        scheduledDate: schedule.scheduledDate.toISOString(),
      },
    },
    select: { id: true },
  });
  return {
    approvalId: approval.id,
    projectId: schedule.projectId,
    projectName: schedule.project.name,
    scheduleId: schedule.id,
    status: schedule.status,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
    tradieTrade: schedule.tradie.trade,
  };
}

async function findSchedule(scheduleId: string, db: DomainDb) {
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      durationDays: true,
      id: true,
      milestoneId: true,
      project: { select: { id: true, name: true, siteManagerId: true } },
      projectId: true,
      quotedPrice: true,
      scheduledDate: true,
      status: true,
      tradie: {
        select: {
          id: true,
          lastQuotedPrice: true,
          lastQuotedPriceUnit: true,
          name: true,
          trade: true,
        },
      },
      tradieId: true,
      milestone: { select: { id: true, name: true } },
    },
    where: { id: scheduleId },
  });
  if (!schedule) throw new DomainNotFoundError("Schedule not found");
  return schedule;
}

function readQuote(
  quote: string | null | undefined,
  quoteUnit: ScheduleQuoteInput["quoteUnit"],
) {
  if (!quote) return null;
  const amount = parseQuotedAmount(quote);
  if (amount === null) {
    throw new DomainValidationError(
      "The quote must contain exactly one non-negative money amount.",
      "quote",
    );
  }
  return normalizeQuoteBasis(amount, quoteUnit ?? "FIXED");
}
