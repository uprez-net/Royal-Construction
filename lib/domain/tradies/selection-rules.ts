import { TradeSelectionStatus, TradieScheduleStatus } from "@prisma/client";

import { INACTIVE_SCHEDULE_STATUSES } from "./lifecycle";
import { sameTrade } from "./request-rules";

// When a tradie may be selected for a whole trade. Pure, and shared by the
// command (trade-selection.ts) and the quote cards, so the Select button is
// never one that can only fail — and says why when it is off.

/** What "the same trade" means for a selection. */
export function tradeKey(trade: string): string {
  return trade.trim().toLowerCase();
}

/** Statuses a quote can still be entered or replaced on. */
export const QUOTABLE_STATUSES: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.AWAITING_QUOTE,
  TradieScheduleStatus.QUOTE_RECEIVED,
];

/** Already through, or past, the admin's approval. */
export const APPROVED_STATUSES: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
  TradieScheduleStatus.CONFIRMED,
  TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
];

/** A selection that still holds the trade. */
export const LIVE_SELECTION_STATUSES: readonly TradeSelectionStatus[] = [
  TradeSelectionStatus.ACTIVE,
  TradeSelectionStatus.CANCELLATION_PENDING,
];

const STATUS_WORDS: Partial<Record<TradieScheduleStatus, string>> = {
  AWAITING_ADMIN_APPROVAL: "waiting on admin approval",
  CONFIRMED: "confirmed",
  PENDING_FINAL_CONFIRMATION: "approved",
};

export type SelectionBooking = {
  readonly status: TradieScheduleStatus;
  readonly quotedPrice: string | null;
  readonly milestoneId: string | null;
  readonly milestoneName: string | null;
  readonly tradieName: string;
  readonly trade: string;
};

export type SelectionRefusal = {
  readonly kind: "validation" | "transition";
  readonly message: string;
};

/**
 * Why this tradie cannot be selected for the trade now, or null when they can.
 *
 * @param own the tradie's bookings on the project, any status.
 * @param others every other tradie's bookings on the project, any status.
 */
export function selectionRefusal(input: {
  readonly tradieName: string;
  readonly trade: string;
  readonly liveSelection: {
    readonly tradieName: string;
    readonly status: TradeSelectionStatus;
  } | null;
  readonly own: readonly SelectionBooking[];
  readonly others: readonly SelectionBooking[];
}): SelectionRefusal | null {
  const { tradieName, trade } = input;
  if (input.liveSelection) {
    return {
      kind: "transition",
      message:
        input.liveSelection.status === TradeSelectionStatus.CANCELLATION_PENDING
          ? `${input.liveSelection.tradieName}'s cancellation for ${trade} is waiting on an admin. Select again once it is approved.`
          : `${input.liveSelection.tradieName} is already selected for ${trade}. Request their cancellation before choosing someone else.`,
    };
  }

  const open = input.own.filter(
    (booking) => !INACTIVE_SCHEDULE_STATUSES.includes(booking.status),
  );
  if (open.length === 0) {
    return {
      kind: "validation",
      message: `${tradieName} has no open ${trade} booking on this project to select.`,
    };
  }

  const unpriced = open.filter(
    (booking) =>
      !APPROVED_STATUSES.includes(booking.status)
      && (booking.status !== TradieScheduleStatus.QUOTE_RECEIVED
        || !booking.quotedPrice),
  );
  if (unpriced.length > 0) {
    const names = unpriced.map(
      (booking) => booking.milestoneName ?? "the general booking",
    );
    return {
      kind: "validation",
      message: `Record ${tradieName}'s quote for ${names.join(", ")} first: an approval needs the amount.`,
    };
  }

  const milestoneIds = new Set(
    open
      .map((booking) => booking.milestoneId)
      .filter((id): id is string => id !== null),
  );
  const approvedRival = input.others.find(
    (booking) =>
      booking.milestoneId !== null
      && milestoneIds.has(booking.milestoneId)
      && sameTrade(booking.trade, trade)
      && APPROVED_STATUSES.includes(booking.status),
  );
  if (approvedRival) {
    return {
      kind: "transition",
      message: `${approvedRival.tradieName} is already ${STATUS_WORDS[approvedRival.status]} for ${approvedRival.milestoneName ?? "this trade"}. Remove that booking before selecting ${tradieName}.`,
    };
  }
  return null;
}

/**
 * The other tradies' bookings a selection cancels: open, in the same trade,
 * on one of the selected tradie's activities.
 */
export function bookingsDisplacedBySelection<
  T extends Pick<SelectionBooking, "status" | "milestoneId" | "trade">,
>(own: readonly SelectionBooking[], others: readonly T[], trade: string): T[] {
  const milestoneIds = new Set(
    own
      .filter((booking) => !INACTIVE_SCHEDULE_STATUSES.includes(booking.status))
      .map((booking) => booking.milestoneId)
      .filter((id): id is string => id !== null),
  );
  return others.filter(
    (booking) =>
      booking.milestoneId !== null
      && milestoneIds.has(booking.milestoneId)
      && sameTrade(booking.trade, trade)
      && !INACTIVE_SCHEDULE_STATUSES.includes(booking.status),
  );
}
