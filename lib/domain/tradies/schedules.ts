import {
  Prisma,
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieScheduleStatus,
} from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainError,
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { authorizeProject, canManageProject } from "../access/projects";
import { assertCanReadTradieDirectory } from "../access/tradies";
import { INACTIVE_SCHEDULE_STATUSES, requireActiveTradie } from "./lifecycle";
import {
  notReschedulableReason,
  rescheduleOutcome,
  type RescheduleNotice,
} from "./reschedule-rules";
import { canTransitionSchedule } from "./schedule-transitions";
import {
  normalizeQuoteBasis,
  parseQuotedAmount,
  scheduleTotalCost,
} from "../../../utils/calculations";
import { currency } from "../../../utils/formatters";

// Booking a tradie onto a project.
//
// What the command refuses, for both callers (the app and Eve):
//
//   - The same booking twice. One tradie, one project, one milestone (or none)
//     can hold one active booking. A second identical row would send the
//     tradie a second request for work they already have and put the same job
//     on the project twice. To change the dates, reschedule the booking that
//     exists.
//   - A milestone that does not belong to the project. Both ids arrive from
//     the client, so a booking could be attached to a milestone on somebody
//     else's project.
//
// What it no longer refuses: a tradie booked on overlapping days. The office
// books one tradie onto two sites, or two milestones, on the same day, and a
// hard refusal stopped them doing it. The picker shows the days already
// booked instead (`listTradieBookings`), so the double booking is a decision
// made with the clash in view rather than one the command makes for them.

export type CreateScheduleInput = {
  readonly tradieId: string;
  readonly projectId: string;
  readonly milestoneId?: string | null;
  readonly scheduledDate: Date;
  readonly durationDays: number;
  readonly requiresQuote: boolean;
};

/**
 * Statuses that no longer hold the tradie's time.
 *
 * A declined booking was never accepted and a completed one is in the past, so
 * neither counts as booked: neither shows on the picker, and neither stops the
 * same tradie being booked onto the same milestone again.
 */
const NON_BLOCKING_STATUSES = INACTIVE_SCHEDULE_STATUSES;

/** "12 Oct 2026" — schedule dates are stored at UTC midnight. */
function bookingDay(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

/**
 * Refuse a booking this tradie already holds on the same project and milestone.
 *
 * "No milestone" is a milestone for this purpose: a second general booking for
 * the same tradie on the same project is the same booking again. Dates play no
 * part — moving one is a reschedule, not a second booking.
 */
export async function assertNotAlreadyBooked(
  input: {
    tradieId: string;
    projectId: string;
    milestoneId: string | null;
    /** An existing booking being changed, which must not match itself. */
    ignoreScheduleId?: string;
  },
  db: DomainDb,
): Promise<void> {
  const existing = await db.tradieSchedule.findFirst({
    select: { durationDays: true, scheduledDate: true },
    where: {
      id: input.ignoreScheduleId ? { not: input.ignoreScheduleId } : undefined,
      milestoneId: input.milestoneId,
      projectId: input.projectId,
      status: { notIn: NON_BLOCKING_STATUSES },
      tradieId: input.tradieId,
    },
  });
  if (!existing) return;

  // The dates, so the operator can find the booking to reschedule.
  const lastDay = new Date(existing.scheduledDate);
  lastDay.setUTCDate(lastDay.getUTCDate() + existing.durationDays - 1);
  const booked =
    existing.durationDays > 1
      ? `from ${bookingDay(existing.scheduledDate)} to ${bookingDay(lastDay)}`
      : `on ${bookingDay(existing.scheduledDate)}`;
  const work = input.milestoneId ? "this milestone" : "this project";
  throw new DomainTransitionError(
    `That tradie is already booked for ${work} ${booked}. Reschedule that booking instead of adding another.`,
  );
}

export type TradieBooking = {
  readonly scheduleId: string;
  readonly projectId: string;
  /**
   * Null when the caller may not manage that project: they still learn the
   * tradie is busy, which is what stops a double booking, without learning
   * whose build it is.
   */
  readonly projectName: string | null;
  /** Null for no milestone, and when the project is not the caller's. */
  readonly milestoneId: string | null;
  readonly milestoneName: string | null;
  readonly status: TradieScheduleStatus;
  /** First working day, `YYYY-MM-DD`. */
  readonly firstDay: string;
  /** Last working day, inclusive, `YYYY-MM-DD`. */
  readonly lastDay: string;
};

/** How far back a booking can start and still be running today. */
const BOOKING_LOOKBACK_DAYS = 366;

/**
 * The bookings that hold this tradie's time from `from` onwards.
 *
 * For the picker to mark, not to refuse: a booked day can still be booked
 * again. A booking holds `durationDays` days from its first, half-open, and
 * the same `NON_BLOCKING_STATUSES` as `assertNotAlreadyBooked` decide which
 * bookings count.
 */
export async function listTradieBookings(
  principal: DomainPrincipal,
  input: { readonly tradieId: string; readonly from: Date },
  db: DomainDb,
): Promise<TradieBooking[]> {
  assertCanReadTradieDirectory(principal);

  const earliest = new Date(input.from);
  earliest.setUTCDate(earliest.getUTCDate() - BOOKING_LOOKBACK_DAYS);

  const rows = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      durationDays: true,
      id: true,
      milestone: { select: { name: true } },
      milestoneId: true,
      project: { select: { id: true, name: true, siteManagerId: true } },
      scheduledDate: true,
      status: true,
    },
    where: {
      scheduledDate: { gte: earliest },
      status: { notIn: NON_BLOCKING_STATUSES },
      tradieId: input.tradieId,
    },
  });

  return rows.flatMap((row) => {
    const end = new Date(row.scheduledDate);
    end.setUTCDate(end.getUTCDate() + row.durationDays);
    if (end <= input.from) return [];
    const lastDay = new Date(end);
    lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    const visible = canManageProject(principal, row.project);
    return [
      {
        firstDay: row.scheduledDate.toISOString().slice(0, 10),
        lastDay: lastDay.toISOString().slice(0, 10),
        milestoneId: visible ? row.milestoneId : null,
        milestoneName: visible ? (row.milestone?.name ?? null) : null,
        projectId: row.project.id,
        projectName: visible ? row.project.name : null,
        scheduleId: row.id,
        status: row.status,
      },
    ];
  });
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
  const write = async (transactionDb: DomainDb): Promise<CreatedSchedule> => {
    const project = await authorizeProject(
      principal,
      input.projectId,
      transactionDb,
    );

    const tradie = await requireActiveTradie(input.tradieId, transactionDb);

    if (input.milestoneId) {
      await assertMilestoneOnProject(
        project.id,
        input.milestoneId,
        transactionDb,
      );
    }

    await assertNotAlreadyBooked(
      {
        milestoneId: input.milestoneId ?? null,
        projectId: project.id,
        tradieId: tradie.id,
      },
      transactionDb,
    );

    return transactionDb.tradieSchedule.create({
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
  };

  return "$transaction" in db
    ? db.$transaction(write, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    : write(db);
}

/**
 * Create a batch atomically. The App bulk endpoint used to bypass the single
 * booking command entirely, so it skipped its checks. Running the same command
 * once per row inside one transaction keeps those checks identical — a batch
 * that names the same booking twice is refused at its second row — and makes a
 * partial bulk booking impossible.
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
    for (const [index, input] of inputs.entries()) {
      try {
        created.push(
          await createTradieSchedule(principal, input, transactionDb),
        );
      } catch (error) {
        // Name the row: "That tradie is already booked…" means nothing on a
        // form with five tradies on it.
        if (inputs.length > 1 && error instanceof DomainError) {
          error.message = `Booking ${index + 1}: ${error.message}`;
        }
        throw error;
      }
    }
    return created;
  };
  return "$transaction" in db
    ? db.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    : run(db);
}

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
  input: Parameters<typeof applyScheduleTransition>[1],
  db: DomainDb,
): Promise<ScheduleMutationResult> {
  // The booking, quote and approval must commit together. A failed approval
  // used to leave the booking awaiting an approval that did not exist.
  return "$transaction" in db
    ? db.$transaction((tx) => applyScheduleTransition(principal, input, tx))
    : applyScheduleTransition(principal, input, db);
}

async function applyScheduleTransition(
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
  if (existing.tradie.archivedAt) {
    throw new DomainTransitionError(
      "This tradie has been removed from the active directory.",
    );
  }

  if (
    input.statusAlreadyApplied
    && existing.status !== (input.appliedStatus ?? input.toStatus)
  ) {
    throw new DomainTransitionError(
      "This schedule changed before its approval side effects completed.",
    );
  }
  if (
    !input.statusAlreadyApplied
    && !canTransitionSchedule(existing.status, input.toStatus)
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
        ...(input.toStatus === TradieScheduleStatus.CONFIRMED
        && existing.status !== TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
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
      input.toStatus === TradieScheduleStatus.DECLINED
      && existing.status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
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
    !input.statusAlreadyApplied
    && input.toStatus === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
  ) {
    const requesterId = attributionUserId(principal);
    if (!requesterId && principal.kind !== "system") {
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
        requestSource: principal.kind === "system" ? principal.reason : null,
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

export type RescheduleScheduleResult = ScheduleMutationResult & {
  readonly milestoneId: string | null;
  readonly previousScheduledDate: Date;
  readonly previousDurationDays: number;
  /**
   * The email the tradie is now owed, or `null` when only the milestone moved
   * and the dates the tradie answered for still stand. The command does not
   * send it: the App sends it after this commits and says if it failed, and
   * Eve, which has no mailbox, tells the operator it is still owed.
   */
  readonly notice: RescheduleNotice | null;
  /** A pending approval for the old date was withdrawn. */
  readonly withdrewApproval: boolean;
};

/**
 * Move one booking's dates (or milestone), and put it back to the tradie.
 *
 * The status the booking lands in is `rescheduleOutcome`'s: an approved
 * booking only needs the tradie to confirm the new date, anything else needs
 * their availability again. The week-out reminder and any dismissed alert are
 * reset with it, because both were about the old date.
 *
 * Optimistic on the dates, duration and status the caller saw. The status
 * check is what keeps the dialog honest: it chose its email from the status it
 * was opened on, and a tradie's reply landing in between would otherwise send
 * an "approved, just confirm" email about a booking that is now waiting on an
 * admin.
 */
export async function rescheduleTradieSchedule(
  principal: DomainPrincipal,
  input: {
    scheduleId: string;
    scheduledDate: Date;
    durationDays?: number;
    milestoneId?: string | null;
    /** The status the caller decided from; refused as stale if it moved. */
    expectedStatus?: TradieScheduleStatus;
  },
  db: DomainDb,
): Promise<RescheduleScheduleResult> {
  const write = async (
    transactionDb: DomainDb,
  ): Promise<RescheduleScheduleResult> => {
    const existing = await findSchedule(input.scheduleId, transactionDb);
    await authorizeProject(principal, existing.projectId, transactionDb);
    const durationDays = input.durationDays ?? existing.durationDays;
    if (existing.tradie.archivedAt) {
      throw new DomainTransitionError(
        "This tradie has been removed from the active directory.",
      );
    }
    const outcome = rescheduleOutcome(existing.status);
    if (!outcome) {
      throw new DomainTransitionError(notReschedulableReason(existing.status));
    }
    if (input.expectedStatus && input.expectedStatus !== existing.status) {
      throw new DomainStaleVersionError(
        "This booking changed while you were rescheduling it — the tradie may have replied. Close this and try again.",
      );
    }
    if (!Number.isInteger(durationDays) || durationDays < 1) {
      throw new DomainValidationError(
        "A schedule must last at least one day.",
        "durationDays",
      );
    }
    if (Number.isNaN(input.scheduledDate.getTime())) {
      throw new DomainValidationError(
        "The scheduled date is invalid.",
        "scheduledDate",
      );
    }

    const datesChanged =
      input.scheduledDate.getTime() !== existing.scheduledDate.getTime()
      || durationDays !== existing.durationDays;
    const milestoneChanged =
      input.milestoneId !== undefined
      && input.milestoneId !== existing.milestoneId;
    if (!datesChanged && !milestoneChanged) {
      throw new DomainValidationError(
        "Pick a different date or duration to reschedule this booking.",
        "scheduledDate",
      );
    }

    if (input.milestoneId) {
      await assertMilestoneOnProject(
        existing.projectId,
        input.milestoneId,
        transactionDb,
      );
    }
    // Moving a booking onto another milestone must not turn it into a copy of
    // one the tradie already holds there. A date change cannot.
    if (milestoneChanged) {
      await assertNotAlreadyBooked(
        {
          ignoreScheduleId: existing.id,
          milestoneId: input.milestoneId ?? null,
          projectId: existing.projectId,
          tradieId: existing.tradieId,
        },
        transactionDb,
      );
    }

    // Only a change of dates reopens the booking. Moving it to another
    // milestone on the same days leaves the tradie's answer standing.
    const status = datesChanged ? outcome.status : existing.status;
    const updatedCount = await transactionDb.tradieSchedule.updateMany({
      data: {
        durationDays,
        ...(input.milestoneId !== undefined
          ? { milestoneId: input.milestoneId }
          : {}),
        scheduledDate: input.scheduledDate,
        ...(datesChanged
          ? {
              alertDismissedAt: null,
              alertDismissedStatus: null,
              reminderSentAt: null,
              status,
            }
          : {}),
      },
      where: {
        durationDays: existing.durationDays,
        id: existing.id,
        scheduledDate: existing.scheduledDate,
        status: existing.status,
      },
    });
    if (updatedCount.count !== 1) {
      throw new DomainTransitionError(
        "The schedule changed before it could be rescheduled.",
      );
    }

    let withdrewApproval = false;
    if (datesChanged && outcome.withdrawsApproval) {
      const withdrawn = await transactionDb.tradieApproval.updateMany({
        where: {
          actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
          status: TradieApprovalStatus.PENDING,
          tradieId: existing.tradieId,
          updationData: { path: ["scheduleId"], equals: existing.id },
        },
        data: {
          rejectionReason: `The booking moved to ${bookingDay(input.scheduledDate)}; the tradie has been asked to confirm the new date.`,
          status: TradieApprovalStatus.REJECTED,
        },
      });
      withdrewApproval = withdrawn.count > 0;
    }

    return {
      durationDays,
      milestoneId:
        input.milestoneId !== undefined
          ? input.milestoneId
          : existing.milestoneId,
      notice: datesChanged ? outcome.notice : null,
      previousDurationDays: existing.durationDays,
      previousScheduledDate: existing.scheduledDate,
      previousStatus: existing.status,
      projectId: existing.projectId,
      projectName: existing.project.name,
      quotedPrice: existing.quotedPrice,
      scheduleId: existing.id,
      scheduledDate: input.scheduledDate,
      status,
      tradieId: existing.tradieId,
      tradieName: existing.tradie.name,
      withdrewApproval,
    };
  };

  // The booking and the withdrawn approval commit together, or a booking
  // waiting on the tradie again would leave an approval for the old date in
  // the queue for somebody to approve.
  return "$transaction" in db ? db.$transaction(write) : write(db);
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
  if (schedule.status === TradieScheduleStatus.CANCELLED) {
    throw new DomainTransitionError(
      "A cancelled booking is retained as history and cannot be deleted.",
    );
  }
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
          archivedAt: true,
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
