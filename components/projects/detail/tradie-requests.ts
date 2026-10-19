import { TradieScheduleStatus } from "@prisma/client";
import { format } from "date-fns";

import { INACTIVE_SCHEDULE_STATUSES } from "@/lib/domain/tradies/lifecycle";
import {
  activityAcceptsTrade,
  isRequestableMilestone,
  sameTrade,
} from "@/lib/domain/tradies/request-rules";
import {
  bookingsDisplacedBySelection,
  LIVE_SELECTION_STATUSES,
  selectionRefusal,
  type SelectionBooking,
} from "@/lib/domain/tradies/selection-rules";
import type {
  ProjectDetail,
  SafeMilestone,
  TradeSelectionSummary,
  TradieRequestDeliverySummary,
  TradieScheduleWithTradieAndMilestone,
} from "@/types/project";
import { parseQuotedAmount } from "@/utils/calculations";

// How the Tradies tab and the request wizard read a project by trade.
//
// A trade's "activities" are its milestones: the build sequence names the
// trade a milestone needs (`requiredTradeType`), and every booking hangs off
// one. Nothing here is stored per trade — it is all derived from the
// milestones and bookings the project page already holds, so it cannot drift
// from them.

type Schedule = TradieScheduleWithTradieAndMilestone;

export type RequestMilestone = Pick<
  SafeMilestone,
  | "id"
  | "name"
  | "order"
  | "projectStage"
  | "status"
  | "startDate"
  | "targetDate"
  | "estimatedDays"
  | "requiredTradeType"
>;

const INACTIVE = new Set<TradieScheduleStatus>(INACTIVE_SCHEDULE_STATUSES);

/** Holds the tradie's time: the same test the duplicate-booking rule applies. */
export function isActiveSchedule(status: TradieScheduleStatus): boolean {
  return !INACTIVE.has(status);
}

/**
 * The trades a request can be raised for: every trade in the directory, plus
 * any the build sequence needs that the directory has nobody for yet — so the
 * gap shows rather than the activity silently missing from every list.
 * "Others" is the directory's bucket for tradies with no trade, which nothing
 * can be requested from.
 */
export function requestTradeOptions(
  milestones: readonly RequestMilestone[],
  directoryTrades: readonly string[],
): string[] {
  const trades: string[] = [];
  const add = (trade: string | undefined | null) => {
    const label = trade?.trim();
    if (!label || label === "Others") return;
    if (!trades.some((existing) => sameTrade(existing, label))) {
      trades.push(label);
    }
  };
  directoryTrades.forEach(add);
  milestones
    .filter((milestone) => isRequestableMilestone(milestone.status))
    .forEach((milestone) => add(milestone.requiredTradeType?.label));
  return trades.sort((a, b) => a.localeCompare(b));
}

/**
 * The open activities a trade can be asked for, in build order.
 *
 * By default only those the build sequence says need this trade. With
 * `includeUnassigned`, also those that name no trade at all — the command
 * accepts either, and refuses an activity that names a different trade.
 */
export function requestableActivities<T extends RequestMilestone>(
  milestones: readonly T[],
  options: {
    readonly trade: string;
    readonly stage?: SafeMilestone["projectStage"] | null;
    readonly includeUnassigned?: boolean;
  },
): T[] {
  return milestones
    .filter((milestone) => isRequestableMilestone(milestone.status))
    .filter(
      (milestone) => !options.stage || milestone.projectStage === options.stage,
    )
    .filter((milestone) => {
      const required = milestone.requiredTradeType?.label;
      if (!required) return Boolean(options.includeUnassigned);
      return activityAcceptsTrade(required, options.trade);
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Where an activity's approximate date starts: the milestone's start, or its
 * target when it has not started, never earlier than today — a request asking
 * a tradie to quote for last week reads as a mistake.
 */
export function defaultActivityDate(
  milestone: Pick<RequestMilestone, "startDate" | "targetDate">,
  today: Date = new Date(),
): string {
  const todayKey = format(today, "yyyy-MM-dd");
  const planned = milestone.startDate ?? milestone.targetDate;
  if (!planned) return todayKey;
  // Milestone dates are calendar days stored at UTC midnight.
  const plannedKey = new Date(planned).toISOString().slice(0, 10);
  return plannedKey < todayKey ? todayKey : plannedKey;
}

/** The booking that would make a new request for this pair a duplicate. */
export function activeRequestFor(
  schedules: readonly Schedule[],
  tradieId: string,
  milestoneId: string,
): Schedule | undefined {
  return schedules.find(
    (schedule) =>
      schedule.tradieId === tradieId
      && schedule.milestoneId === milestoneId
      && isActiveSchedule(schedule.status),
  );
}

// ---------------------------------------------------------------------------
// The Tradies tab, grouped by trade
// ---------------------------------------------------------------------------

/** Approved, or done: the activity has its tradie. */
const COVERING_STATUSES = new Set<TradieScheduleStatus>([
  TradieScheduleStatus.CONFIRMED,
  TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  TradieScheduleStatus.COMPLETED,
]);

export type TradeTradie = {
  readonly tradieId: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  /** This tradie's bookings in the trade, cancelled ones included. */
  readonly schedules: readonly Schedule[];
  /** Bookings still in play: not declined, completed or cancelled. */
  readonly openCount: number;
  /** Sum of the quotes received, or null when none has arrived. */
  readonly quotedTotal: number | null;
  readonly quotedCount: number;
  /** Earliest upcoming open booking. */
  readonly nextDate: Date | null;
  /** Approved on at least one activity. */
  readonly approved: boolean;
  /** Their most recent request email, when they were sent one. */
  readonly delivery: TradieRequestDeliverySummary | null;
  /** The trade's live selection is this tradie. */
  readonly selected: boolean;
  /** Why Select is off for them, or null when it is on. */
  readonly selectBlockedBy: string | null;
  /** Other tradies' bookings selecting them would cancel. */
  readonly displaces: number;
};

export type TradeActivity = {
  readonly milestoneId: string | null;
  readonly name: string;
  readonly stage: SafeMilestone["projectStage"] | null;
  readonly milestoneStatus: SafeMilestone["status"] | null;
  readonly schedules: readonly Schedule[];
  readonly covered: boolean;
};

export type TradeOverview = {
  readonly trade: string;
  /** Who holds the trade: active, or waiting on a cancellation. */
  readonly selection: TradeSelectionSummary | null;
  readonly tradies: readonly TradeTradie[];
  readonly activities: readonly TradeActivity[];
  readonly stats: {
    readonly recipients: number;
    readonly replies: number;
    readonly lowest: { readonly name: string; readonly amount: number } | null;
    readonly covered: number;
    readonly activityCount: number;
  };
};

/** Every trade on the project: booked, or needed by an open activity. */
export function projectTrades(
  project: Pick<ProjectDetail, "milestones" | "tradieSchedules">,
): string[] {
  return requestTradeOptions(
    project.milestones,
    project.tradieSchedules.map((schedule) => schedule.tradie.trade),
  );
}

/** Bookings for a trade, or all of them when `trade` is null. */
export function schedulesForTrade(
  schedules: readonly Schedule[],
  trade: string | null,
): Schedule[] {
  return trade
    ? schedules.filter((schedule) => sameTrade(schedule.tradie.trade, trade))
    : [...schedules];
}

function asSelectionBooking(schedule: Schedule): SelectionBooking & {
  readonly tradieId: string;
} {
  return {
    milestoneId: schedule.milestoneId,
    milestoneName: schedule.milestone?.name ?? null,
    quotedPrice: schedule.quotedPrice,
    status: schedule.status,
    trade: schedule.tradie.trade,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
  };
}

/** The most recent request email among a tradie's bookings. */
function latestDelivery(
  schedules: readonly Schedule[],
): TradieRequestDeliverySummary | null {
  return schedules
    .map((schedule) => schedule.requestRecipient)
    .filter(
      (recipient): recipient is TradieRequestDeliverySummary => !!recipient,
    )
    .reduce<TradieRequestDeliverySummary | null>(
      (latest, recipient) =>
        !latest
        || new Date(recipient.request.createdAt)
          > new Date(latest.request.createdAt)
          ? recipient
          : latest,
      null,
    );
}

export function tradeOverview(
  project: Pick<ProjectDetail, "milestones" | "tradieSchedules">
    & Partial<Pick<ProjectDetail, "tradeSelections">>,
  trade: string,
  now: Date = new Date(),
): TradeOverview {
  const schedules = schedulesForTrade(project.tradieSchedules, trade);
  const selection =
    project.tradeSelections?.find(
      (item) =>
        sameTrade(item.trade, trade)
        && LIVE_SELECTION_STATUSES.includes(item.status),
    ) ?? null;
  const allBookings = project.tradieSchedules.map(asSelectionBooking);

  const byTradie = new Map<string, Schedule[]>();
  for (const schedule of schedules) {
    byTradie.set(schedule.tradieId, [
      ...(byTradie.get(schedule.tradieId) ?? []),
      schedule,
    ]);
  }

  const tradies: TradeTradie[] = [...byTradie.values()].map((own) => {
    const quotes = own
      .filter((schedule) => schedule.status !== TradieScheduleStatus.CANCELLED)
      .map((schedule) => parseQuotedAmount(schedule.quotedPrice))
      .filter((amount): amount is number => amount !== null);
    const open = own.filter((schedule) => isActiveSchedule(schedule.status));
    const upcoming = open
      .map((schedule) => new Date(schedule.scheduledDate))
      .filter((date) => date.getTime() >= now.getTime() - 86_400_000)
      .sort((a, b) => a.getTime() - b.getTime());
    const { tradie } = own[0];
    const mine = allBookings.filter(
      (booking) => booking.tradieId === tradie.id,
    );
    const others = allBookings.filter(
      (booking) => booking.tradieId !== tradie.id,
    );
    const refusal = selectionRefusal({
      liveSelection: selection
        ? { status: selection.status, tradieName: selection.tradie.name }
        : null,
      others,
      own: mine,
      trade,
      tradieName: tradie.name,
    });
    return {
      approved: own.some((schedule) => COVERING_STATUSES.has(schedule.status)),
      delivery: latestDelivery(own),
      displaces: refusal
        ? 0
        : bookingsDisplacedBySelection(mine, others, trade).length,
      selectBlockedBy: refusal?.message ?? null,
      selected: selection?.tradieId === tradie.id,
      email: tradie.email,
      name: tradie.name,
      nextDate: upcoming[0] ?? null,
      openCount: open.length,
      phone: tradie.phone,
      quotedCount: quotes.length,
      quotedTotal:
        quotes.length > 0
          ? quotes.reduce((sum, value) => sum + value, 0)
          : null,
      schedules: own,
      tradieId: tradie.id,
    };
  });
  // Quoted first, cheapest first; then everyone still to reply, by name.
  tradies.sort((a, b) =>
    a.quotedTotal !== null && b.quotedTotal !== null
      ? a.quotedTotal - b.quotedTotal
      : a.quotedTotal !== null
        ? -1
        : b.quotedTotal !== null
          ? 1
          : a.name.localeCompare(b.name),
  );

  // The activities that need this trade, plus any this trade is booked on
  // that the build sequence does not name it for.
  const milestones = [...project.milestones]
    .filter(
      (milestone) =>
        (milestone.requiredTradeType
          && sameTrade(milestone.requiredTradeType.label, trade))
        || schedules.some((schedule) => schedule.milestoneId === milestone.id),
    )
    .sort((a, b) => a.order - b.order);
  const activities: TradeActivity[] = milestones.map((milestone) => {
    const own = schedules.filter(
      (schedule) => schedule.milestoneId === milestone.id,
    );
    return {
      covered: own.some((schedule) => COVERING_STATUSES.has(schedule.status)),
      milestoneId: milestone.id,
      milestoneStatus: milestone.status,
      name: milestone.name,
      schedules: own,
      stage: milestone.projectStage,
    };
  });
  const general = schedules.filter((schedule) => !schedule.milestoneId);
  if (general.length > 0) {
    activities.push({
      covered: general.some((schedule) =>
        COVERING_STATUSES.has(schedule.status),
      ),
      milestoneId: null,
      milestoneStatus: null,
      name: "Not linked to a milestone",
      schedules: general,
      stage: null,
    });
  }

  const quoted = tradies.filter((tradie) => tradie.quotedTotal !== null);
  const lowest = quoted[0];
  // A waived activity needs nobody, so it is neither covered nor missing.
  const counted = activities.filter(
    (activity) => activity.milestoneStatus !== "NOT_REQUIRED",
  );

  return {
    activities,
    selection,
    stats: {
      activityCount: counted.length,
      covered: counted.filter(
        (activity) => activity.covered || activity.milestoneStatus === "DONE",
      ).length,
      lowest: lowest
        ? { amount: lowest.quotedTotal as number, name: lowest.name }
        : null,
      recipients: tradies.length,
      replies: quoted.length,
    },
    trade,
    tradies,
  };
}
