import {
  Prisma,
  TradeSelectionStatus,
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieQuoteSource,
  TradieScheduleStatus,
  type TradieQuoteGst,
} from "@prisma/client";

import { sydneyDateOnly } from "@/lib/dates/sydney";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { recordTradieActivity } from "../audit/tradie-activity-log";
import { authorizeProject } from "../access/projects";
import { INACTIVE_SCHEDULE_STATUSES, requireActiveTradie } from "./lifecycle";
import {
  activityAcceptsTrade,
  bookingTrade,
  isRequestableMilestone,
  MAX_REQUEST_ACTIVITIES,
  sameTrade,
  tradeList,
  tradieTradeLabel,
} from "./request-rules";
import { createTradieSchedule, transitionTradieSchedule } from "./schedules";
import {
  bookingsDisplacedBySelection,
  LIVE_SELECTION_STATUSES,
  QUOTABLE_STATUSES,
  quoteEntryFor,
  selectionRefusal,
  tradeKey,
  type QuoteEntry,
} from "./selection-rules";
import { currency, rateCurrency } from "../../../utils/formatters";

// Choosing one tradie for a whole trade on a project, and the quotes that
// choice is made from.
//
// A quote's amounts live on the bookings it priced — one per activity —
// because milestone spend is counted per booking. `TradieQuote` records where
// they came from: an emailed reply or the office.
//
// Selecting a quote is the decision the per-booking status dialog used to be
// asked to make activity by activity: the chosen tradie's bookings go to the
// admin approval queue with their quoted amounts, exactly as a received quote
// does today, and every other tradie's open booking on the same activities is
// cancelled. Nobody else is emailed.
//
// Changing your mind is not a second selection. Once a tradie is selected the
// way out is a cancellation request, which an admin approves — because by then
// the approvals are moving and the tradie may have been told.

const STATUS_WORDS: Partial<Record<TradieScheduleStatus, string>> = {
  AWAITING_ADMIN_APPROVAL: "waiting on admin approval",
  CONFIRMED: "confirmed",
  PENDING_FINAL_CONFIRMATION: "approved",
  PENDING: "waiting on the tradie",
  PENDING_RESPONSE: "waiting on the tradie",
  NO_RESPONSE: "unanswered",
};

function serializable<T>(
  db: DomainDb,
  run: (tx: DomainDb) => Promise<T>,
): Promise<T> {
  return "$transaction" in db
    ? db.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    : run(db);
}

function money(amount: number): string {
  return amount.toFixed(2);
}

/** `bookingTrade` as a query: the booking's trade, else its tradie's. */
export function bookingInTradeWhere(
  trade: string,
): Prisma.TradieScheduleWhereInput {
  return {
    OR: [
      { trade: { equals: trade.trim(), mode: "insensitive" } },
      {
        trade: null,
        tradie: { trade: { equals: trade.trim(), mode: "insensitive" } },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Manual quote
// ---------------------------------------------------------------------------

export type ManualQuoteInput = {
  readonly projectId: string;
  readonly tradieId: string;
  /** The trade quoted for; the tradie's primary trade when omitted. */
  readonly trade?: string;
  readonly lines: readonly {
    readonly milestoneId: string;
    /** Dollars, as the tradie priced it under `gstTreatment`. */
    readonly amount: number;
  }[];
  readonly gstTreatment: TradieQuoteGst;
  readonly quotedAt: Date;
  readonly validUntil?: Date | null;
  readonly notes?: string | null;
  /** Overridable so a test does not depend on the wall clock. */
  readonly today?: Date;
};

export type RecordedManualQuote = {
  readonly quoteId: string;
  readonly tradieName: string;
  readonly trade: string;
  /** Bookings the quote was written to; `created` when it made one. */
  readonly bookings: readonly { scheduleId: string; created: boolean }[];
};

/**
 * Record a quote the office received some other way — a phone call, a PDF
 * handed over on site — with an amount per activity.
 *
 * Written onto the tradie's booking for each activity. A tradie who was never
 * sent a request gets a booking made for them, through the same create as
 * every other booking, so the duplicate and project checks still apply. A
 * booking that is already approved keeps its price: changing an approved
 * amount is a decision for the admin, not a form.
 */
export async function recordManualQuote(
  principal: DomainPrincipal,
  input: ManualQuoteInput,
  db: DomainDb,
): Promise<RecordedManualQuote> {
  if (input.lines.length === 0) {
    throw new DomainValidationError(
      "Add an amount for at least one activity.",
      "lines",
    );
  }
  if (input.lines.length > MAX_REQUEST_ACTIVITIES) {
    throw new DomainValidationError(
      `A quote can cover at most ${MAX_REQUEST_ACTIVITIES} activities.`,
      "lines",
    );
  }
  const milestoneIds = input.lines.map((line) => line.milestoneId);
  if (new Set(milestoneIds).size !== milestoneIds.length) {
    throw new DomainValidationError("The same activity is listed twice.");
  }
  if (
    input.lines.some(
      (line) => !Number.isFinite(line.amount) || line.amount <= 0,
    )
  ) {
    throw new DomainValidationError(
      "Every amount must be more than $0.",
      "lines",
    );
  }
  if (input.validUntil && input.validUntil < input.quotedAt) {
    throw new DomainValidationError(
      "A quote cannot expire before it was given.",
      "validUntil",
    );
  }
  const enteredById = attributionUserId(principal);
  if (!enteredById) {
    throw new DomainAuthorizationError(
      "Entering a quote needs a signed-in user.",
    );
  }

  const project = await authorizeProject(principal, input.projectId, db);
  const tradie = await requireActiveTradie(input.tradieId, db);
  const asked = input.trade?.trim() || tradie.trade.trim();
  if (!asked) {
    throw new DomainValidationError(
      `${tradie.name} has no trade in the directory, so the quote has nothing to price.`,
    );
  }
  const trade = tradieTradeLabel(tradie, asked);
  if (!trade) {
    throw new DomainValidationError(
      `${tradie.name} is not listed under ${asked}, so they cannot quote for it.`,
    );
  }

  const milestones = await db.milestone.findMany({
    select: {
      estimatedDays: true,
      id: true,
      name: true,
      requiredTradeTypes: { select: { label: true } },
      startDate: true,
      status: true,
      targetDate: true,
    },
    where: { id: { in: milestoneIds }, projectId: project.id },
  });
  if (milestones.length !== milestoneIds.length) {
    throw new DomainNotFoundError(
      "One of the activities is not on this project.",
    );
  }
  for (const milestone of milestones) {
    if (!isRequestableMilestone(milestone.status)) {
      throw new DomainValidationError(
        `${milestone.name} is already settled, so it cannot be quoted.`,
      );
    }
    if (!activityAcceptsTrade(milestone.requiredTradeTypes, trade)) {
      throw new DomainValidationError(
        `${milestone.name} needs ${tradeList(milestone.requiredTradeTypes)}, not ${trade}.`,
      );
    }
  }
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));
  // The site's calendar day: before mid-morning in Sydney, UTC is still on
  // yesterday, and the clamp below would let a booking start in the past.
  const todayKey = sydneyDateOnly(input.today ?? new Date());

  return serializable(db, async (tx) => {
    // Once another tradie is selected for the trade a rival quote has nowhere
    // to go: selecting it is refused until that tradie is cancelled.
    const rival = await tx.tradeSelection.findFirst({
      select: { tradie: { select: { name: true } } },
      where: {
        projectId: project.id,
        status: { in: [...LIVE_SELECTION_STATUSES] },
        tradeKey: tradeKey(trade),
        tradieId: { not: tradie.id },
      },
    });
    if (rival) {
      throw new DomainTransitionError(
        `${rival.tradie.name} is already selected for ${trade}. Cancel them before recording another quote.`,
      );
    }

    const quote = await tx.tradieQuote.create({
      data: {
        enteredById,
        gstTreatment: input.gstTreatment,
        notes: input.notes?.trim() || null,
        projectId: project.id,
        quotedAt: input.quotedAt,
        source: TradieQuoteSource.MANUAL,
        trade,
        tradieId: tradie.id,
        validUntil: input.validUntil ?? null,
      },
      select: { id: true },
    });

    const bookings: { scheduleId: string; created: boolean }[] = [];
    for (const line of input.lines) {
      const milestone = milestoneById.get(line.milestoneId)!;
      const existing = await tx.tradieSchedule.findFirst({
        select: {
          id: true,
          quotedPrice: true,
          requestRecipient: { select: { request: { select: { kind: true } } } },
          requiresQuote: true,
          status: true,
        },
        where: {
          // This trade's booking. A tradie doing two trades on one activity
          // must not have a Gas quote written onto their Plumbing booking.
          ...bookingInTradeWhere(trade),
          milestoneId: milestone.id,
          projectId: project.id,
          status: { notIn: INACTIVE_SCHEDULE_STATUSES },
          tradieId: tradie.id,
        },
      });

      let scheduleId: string;
      let created = false;
      // A new booking is made to hold a quote, so it is always one.
      let entry: QuoteEntry = "quote";
      if (existing) {
        entry = quoteEntryFor({
          quotedPrice: existing.quotedPrice,
          requestKind: existing.requestRecipient?.request.kind ?? null,
          requiresQuote: existing.requiresQuote,
          status: existing.status,
        });
        if (entry === "locked") {
          throw new DomainTransitionError(
            `${tradie.name}'s booking for ${milestone.name} is ${STATUS_WORDS[existing.status] ?? existing.status.toLowerCase()}, so its price cannot be changed here.`,
          );
        }
        scheduleId = existing.id;
      } else {
        // Dates follow whoever else was asked for this activity, so the
        // quotes compare like with like; otherwise the milestone's own.
        const sibling = await tx.tradieSchedule.findFirst({
          orderBy: { scheduledDate: "asc" },
          select: { durationDays: true, scheduledDate: true },
          where: {
            milestoneId: milestone.id,
            projectId: project.id,
            status: { notIn: INACTIVE_SCHEDULE_STATUSES },
          },
        });
        const planned = (milestone.startDate ?? milestone.targetDate)
          .toISOString()
          .slice(0, 10);
        const day = planned < todayKey ? todayKey : planned;
        const booking = await createTradieSchedule(
          principal,
          {
            durationDays:
              sibling?.durationDays ?? Math.max(1, milestone.estimatedDays),
            milestoneId: milestone.id,
            projectId: project.id,
            requiresQuote: true,
            scheduledDate:
              sibling?.scheduledDate ?? new Date(`${day}T00:00:00.000Z`),
            trade,
            tradieId: tradie.id,
          },
          tx,
        );
        scheduleId = booking.id;
        created = true;
      }

      // A booked tradie's price lands where the booking already is; it is not
      // in a comparison, and "quote received" would undo a confirmation. It
      // also stays a booking that was not asked to quote, so `quoteEntryFor`
      // still lets the office correct the price before approval.
      const written = await tx.tradieSchedule.updateMany({
        data: {
          quoteId: quote.id,
          quotedPrice: money(line.amount),
          ...(entry === "quote"
            ? {
                requiresQuote: true,
                status: TradieScheduleStatus.QUOTE_RECEIVED,
              }
            : {}),
        },
        where:
          entry === "quote" || !existing
            ? { id: scheduleId, status: { in: [...QUOTABLE_STATUSES] } }
            : {
                id: scheduleId,
                quotedPrice: existing.quotedPrice,
                status: existing.status,
              },
      });
      if (written.count !== 1) {
        throw new DomainTransitionError(
          `${tradie.name}'s booking for ${milestone.name} changed while the quote was being saved. Refresh and try again.`,
        );
      }
      await recordTradieActivity(
        {
          data: {
            amount: rateCurrency.format(line.amount),
            milestoneId: milestone.id,
            priceOnly: entry === "price",
            projectId: project.id,
            scheduleId,
            tradieId: tradie.id,
          },
          principal,
          type: "quoteRecorded",
        },
        tx,
      );
      // The admin decides a waiting approval from the cost it shows; it was
      // worked out before this price existed.
      if (
        existing
        && existing.status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
      ) {
        await refreshPendingApprovalCost(
          { amount: line.amount, scheduleId, tradieId: tradie.id },
          tx,
        );
      }
      bookings.push({ created, scheduleId });
    }

    return { bookings, quoteId: quote.id, trade, tradieName: tradie.name };
  });
}

async function refreshPendingApprovalCost(
  input: {
    readonly scheduleId: string;
    readonly tradieId: string;
    readonly amount: number;
  },
  tx: DomainDb,
): Promise<void> {
  const approval = await tx.tradieApproval.findFirst({
    select: { id: true, updationData: true },
    where: {
      actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
      status: TradieApprovalStatus.PENDING,
      tradieId: input.tradieId,
      updationData: { equals: input.scheduleId, path: ["scheduleId"] },
    },
  });
  const payload = approval?.updationData;
  if (
    !approval
    || !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
  ) {
    return;
  }
  await tx.tradieApproval.update({
    data: { updationData: { ...payload, cost: currency.format(input.amount) } },
    where: { id: approval.id },
  });
}

// ---------------------------------------------------------------------------
// Select a quote
// ---------------------------------------------------------------------------

export type SelectedTradeQuote = {
  readonly selectionId: string;
  readonly trade: string;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly projectName: string;
  /** Bookings sent to the admin queue by this selection. */
  readonly approvals: readonly { scheduleId: string; approvalId: string }[];
  /** Other tradies' bookings this selection cancelled. */
  readonly cancelled: readonly {
    scheduleId: string;
    tradieName: string;
    milestoneName: string | null;
  }[];
};

/**
 * Choose one tradie for a trade on a project.
 *
 * Refuses, before writing anything:
 * - a trade that already has a tradie selected (cancel that one first);
 * - a tradie with no open booking in the trade, or one still without a quote
 *   on an activity — the approval needs the amount;
 * - when another tradie is already approved on one of the activities.
 */
export async function selectTradeQuote(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly tradieId: string;
    /** The trade being chosen for; the tradie's primary trade when omitted. */
    readonly trade?: string;
  },
  db: DomainDb,
): Promise<SelectedTradeQuote> {
  const project = await authorizeProject(principal, input.projectId, db);
  const tradie = await requireActiveTradie(input.tradieId, db);
  const asked = input.trade?.trim() || tradie.trade.trim();
  const trade = tradieTradeLabel(tradie, asked);
  if (!trade) {
    throw new DomainValidationError(
      `${tradie.name} is not listed under ${asked}.`,
    );
  }
  const key = tradeKey(trade);

  return serializable(db, async (tx) => {
    const live = await tx.tradeSelection.findFirst({
      select: { status: true, tradie: { select: { name: true } } },
      where: {
        projectId: project.id,
        status: { in: [...LIVE_SELECTION_STATUSES] },
        tradeKey: key,
      },
    });
    const bookings = await tx.tradieSchedule.findMany({
      select: {
        id: true,
        milestone: { select: { name: true } },
        milestoneId: true,
        quotedPrice: true,
        status: true,
        trade: true,
        tradie: { select: { name: true, trade: true } },
        tradieId: true,
      },
      where: { projectId: project.id },
    });
    const asRule = (booking: (typeof bookings)[number]) => ({
      ...booking,
      milestoneName: booking.milestone?.name ?? null,
      trade: bookingTrade(booking),
      tradieName: booking.tradie.name,
    });
    const own = bookings
      .filter((booking) => booking.tradieId === tradie.id)
      .map(asRule);
    const others = bookings
      .filter((booking) => booking.tradieId !== tradie.id)
      .map(asRule);

    const refusal = selectionRefusal({
      liveSelection: live
        ? { status: live.status, tradieName: live.tradie.name }
        : null,
      others,
      own,
      trade,
      tradieName: tradie.name,
    });
    if (refusal) {
      throw refusal.kind === "validation"
        ? new DomainValidationError(refusal.message)
        : new DomainTransitionError(refusal.message);
    }

    const approvals: { scheduleId: string; approvalId: string }[] = [];
    for (const booking of own) {
      if (booking.status !== TradieScheduleStatus.QUOTE_RECEIVED) continue;
      if (!sameTrade(booking.trade, trade)) continue;
      const moved = await transitionTradieSchedule(
        principal,
        {
          scheduleId: booking.id,
          toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        },
        tx,
      );
      if (moved.approvalId) {
        approvals.push({
          approvalId: moved.approvalId,
          scheduleId: booking.id,
        });
      }
    }

    const displaced = bookingsDisplacedBySelection(own, others, trade);
    if (displaced.length > 0) {
      await tx.tradieSchedule.updateMany({
        data: { status: TradieScheduleStatus.CANCELLED },
        where: {
          id: { in: displaced.map((booking) => booking.id) },
          status: { notIn: INACTIVE_SCHEDULE_STATUSES },
        },
      });
    }
    // On each displaced tradie's own history, so their page says why work
    // they were asked about went away.
    for (const booking of displaced) {
      await recordTradieActivity(
        {
          data: {
            milestoneId: booking.milestoneId,
            projectId: project.id,
            reason: `${tradie.name} was selected for ${trade}`,
            scheduleId: booking.id,
            tradieId: booking.tradieId,
          },
          principal,
          type: "bookingCancelled",
        },
        tx,
      );
    }
    await recordTradieActivity(
      {
        data: {
          fromQuote: true,
          projectId: project.id,
          trade,
          tradieId: tradie.id,
        },
        principal,
        type: "selectedForTrade",
      },
      tx,
    );

    const selection = await tx.tradeSelection.create({
      data: {
        projectId: project.id,
        selectedById: attributionUserId(principal),
        trade,
        tradeKey: key,
        tradieId: tradie.id,
      },
      select: { id: true },
    });

    return {
      approvals,
      cancelled: displaced.map((booking) => ({
        milestoneName: booking.milestoneName,
        scheduleId: booking.id,
        tradieName: booking.tradieName,
      })),
      projectName: project.name,
      selectionId: selection.id,
      trade,
      tradieId: tradie.id,
      tradieName: tradie.name,
    };
  });
}

// ---------------------------------------------------------------------------
// Cancel a selected tradie
// ---------------------------------------------------------------------------

export type TradeCancellationPayload = {
  readonly selectionId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly trade: string;
  /** Open bookings the tradie holds in this trade on this project. */
  readonly openBookings: number;
};

/**
 * Ask the admins to release the tradie selected for a trade.
 *
 * Nothing changes on the bookings until an admin approves: the tradie stays
 * selected and their bookings stand. The selection is marked pending so the
 * screen can say so and a second request is refused.
 */
export async function requestTradeCancellation(
  principal: DomainPrincipal,
  input: {
    readonly selectionId: string;
    readonly reason: string;
    /** The project the caller was looking at; a selection elsewhere is not found. */
    readonly projectId?: string;
  },
  db: DomainDb,
): Promise<{
  approvalId: string;
  selectionId: string;
  tradieId: string;
  tradieName: string;
  trade: string;
  projectId: string;
  projectName: string;
}> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainValidationError(
      "Say why the tradie should be cancelled; the admin decides from it.",
      "reason",
    );
  }
  const requestedBy = attributionUserId(principal);
  if (!requestedBy) {
    throw new DomainAuthorizationError(
      "Requesting a cancellation needs a signed-in user.",
    );
  }
  const selection = await db.tradeSelection.findUnique({
    select: {
      id: true,
      projectId: true,
      status: true,
      trade: true,
      tradie: { select: { id: true, name: true } },
    },
    where: { id: input.selectionId },
  });
  if (
    !selection
    || (input.projectId !== undefined
      && selection.projectId !== input.projectId)
  ) {
    throw new DomainNotFoundError("Selection not found.");
  }
  const project = await authorizeProject(principal, selection.projectId, db);
  if (selection.status !== TradeSelectionStatus.ACTIVE) {
    throw new DomainTransitionError(
      selection.status === TradeSelectionStatus.CANCELLATION_PENDING
        ? "A cancellation for this tradie is already waiting on an admin."
        : "This tradie is no longer selected.",
    );
  }

  return serializable(db, async (tx) => {
    const openBookings = await tx.tradieSchedule.count({
      where: {
        ...bookingInTradeWhere(selection.trade),
        projectId: project.id,
        status: { notIn: INACTIVE_SCHEDULE_STATUSES },
        tradieId: selection.tradie.id,
      },
    });
    const payload: TradeCancellationPayload = {
      openBookings,
      projectId: project.id,
      projectName: project.name,
      selectionId: selection.id,
      trade: selection.trade,
    };
    const approval = await tx.tradieApproval.create({
      data: {
        actionType: TradieApprovalActionType.TRADE_CANCELLATION,
        reason,
        requestedBy,
        tradieId: selection.tradie.id,
        updationData: payload,
      },
      select: { id: true },
    });
    const marked = await tx.tradeSelection.updateMany({
      data: {
        cancellationApprovalId: approval.id,
        status: TradeSelectionStatus.CANCELLATION_PENDING,
      },
      where: { id: selection.id, status: TradeSelectionStatus.ACTIVE },
    });
    if (marked.count !== 1) {
      throw new DomainTransitionError(
        "This selection changed while the request was being made. Refresh and try again.",
      );
    }
    await recordTradieActivity(
      {
        data: {
          projectId: project.id,
          reason,
          trade: selection.trade,
          tradieId: selection.tradie.id,
        },
        principal,
        type: "tradeCancellationRequested",
      },
      tx,
    );
    return {
      approvalId: approval.id,
      projectId: project.id,
      projectName: project.name,
      selectionId: selection.id,
      trade: selection.trade,
      tradieId: selection.tradie.id,
      tradieName: selection.tradie.name,
    };
  });
}

/**
 * The approval queue's half of a trade cancellation, run inside its
 * transaction. Approved: the selection ends and every open booking the tradie
 * holds on the project is cancelled, with any approval still pending on them
 * withdrawn. Rejected: the selection stands again.
 */
export async function settleTradeCancellation(
  approval: {
    readonly id: string;
    readonly tradieId: string;
    readonly payload: Record<string, unknown> | null;
  },
  approved: boolean,
  tx: DomainDb,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const selectionId =
    typeof approval.payload?.selectionId === "string"
      ? approval.payload.selectionId
      : null;
  const projectId =
    typeof approval.payload?.projectId === "string"
      ? approval.payload.projectId
      : null;
  if (!selectionId || !projectId) {
    throw new DomainValidationError(
      "This cancellation request has no selection reference.",
    );
  }
  // What the adapter needs to tell the requester, off the request itself.
  const described = {
    projectId,
    projectName:
      typeof approval.payload?.projectName === "string"
        ? approval.payload.projectName
        : "",
    selectionId,
    trade:
      typeof approval.payload?.trade === "string" ? approval.payload.trade : "",
  };

  if (!approved) {
    await tx.tradeSelection.updateMany({
      data: {
        cancellationApprovalId: null,
        status: TradeSelectionStatus.ACTIVE,
      },
      where: {
        cancellationApprovalId: approval.id,
        id: selectionId,
        status: TradeSelectionStatus.CANCELLATION_PENDING,
      },
    });
    return { ...described, status: TradeSelectionStatus.ACTIVE };
  }

  // The trade they were selected for. A tradie who also works in another
  // trade on this job keeps those bookings — so without one, nothing can say
  // which bookings to cancel, and cancelling all of them is the wrong guess.
  const trade = described.trade.trim();
  if (!trade) {
    throw new DomainValidationError(
      "This cancellation request does not say which trade it is for.",
    );
  }

  const ended = await tx.tradeSelection.updateMany({
    data: { cancelledAt: now, status: TradeSelectionStatus.CANCELLED },
    where: {
      cancellationApprovalId: approval.id,
      id: selectionId,
      status: TradeSelectionStatus.CANCELLATION_PENDING,
    },
  });
  if (ended.count !== 1) {
    throw new DomainTransitionError(
      "This selection is no longer waiting on a cancellation.",
    );
  }
  const bookings = await tx.tradieSchedule.findMany({
    select: { id: true },
    where: {
      ...bookingInTradeWhere(trade),
      projectId,
      status: { notIn: INACTIVE_SCHEDULE_STATUSES },
      tradieId: approval.tradieId,
    },
  });
  const ids = bookings.map((booking) => booking.id);
  if (ids.length > 0) {
    await tx.tradieSchedule.updateMany({
      data: { status: TradieScheduleStatus.CANCELLED },
      where: { id: { in: ids } },
    });
    // An approval for a booking that no longer exists in any useful sense
    // would sit in the queue asking an admin to approve nothing.
    for (const scheduleId of ids) {
      await tx.tradieApproval.updateMany({
        data: {
          rejectionReason: "The tradie was cancelled for this trade.",
          status: TradieApprovalStatus.REJECTED,
        },
        where: {
          actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
          status: TradieApprovalStatus.PENDING,
          tradieId: approval.tradieId,
          updationData: { equals: scheduleId, path: ["scheduleId"] },
        },
      });
    }
  }
  return {
    ...described,
    cancelledSchedules: ids.length,
    status: TradeSelectionStatus.CANCELLED,
  };
}
