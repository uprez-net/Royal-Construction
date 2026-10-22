import {
  TradeSelectionStatus,
  TradieRequestKind,
  TradieScheduleStatus,
} from "@prisma/client";

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

  // Only this trade's bookings: a tradie working in several trades is
  // selected for one, and their bookings in another are not part of it.
  const open = input.own.filter(
    (booking) =>
      !INACTIVE_SCHEDULE_STATUSES.includes(booking.status)
      && sameTrade(booking.trade, trade),
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

  const rival = approvedRival(
    open.map((booking) => booking.milestoneId),
    input.others,
    trade,
  );
  if (rival) {
    return {
      kind: "transition",
      message: `${rival.tradieName} is already ${STATUS_WORDS[rival.status]} for ${rival.milestoneName ?? "this trade"}. Remove that booking before selecting ${tradieName}.`,
    };
  }
  return null;
}

/**
 * Another tradie already approved, or waiting on approval, in this trade on
 * one of these activities. Selecting or booking a second one would put two
 * tradies on the same work.
 */
function approvedRival(
  milestoneIds: readonly (string | null)[],
  others: readonly SelectionBooking[],
  trade: string,
): SelectionBooking | undefined {
  const ids = new Set(milestoneIds.filter((id): id is string => id !== null));
  return others.find(
    (booking) =>
      booking.milestoneId !== null
      && ids.has(booking.milestoneId)
      && sameTrade(booking.trade, trade)
      && APPROVED_STATUSES.includes(booking.status),
  );
}

/**
 * Why this tradie cannot be booked directly for these activities, or null.
 *
 * Booking directly is choosing the tradie without a quote: the request command
 * records the same trade selection a chosen quote does, so the rules that stop
 * a selection stop it too — someone else holds the trade, or someone else is
 * already approved on the work. What it does not need is a priced quote; the
 * price can be recorded on the bookings later (`quoteEntryFor`).
 *
 * @param others every other tradie's bookings on the project, any status.
 */
export function directBookingRefusal(input: {
  readonly tradieId: string;
  readonly tradieName: string;
  readonly trade: string;
  readonly liveSelection: {
    readonly tradieId: string;
    readonly tradieName: string;
    readonly status: TradeSelectionStatus;
  } | null;
  readonly milestoneIds: readonly string[];
  readonly others: readonly SelectionBooking[];
}): SelectionRefusal | null {
  const { liveSelection, trade, tradieName } = input;
  if (liveSelection) {
    if (liveSelection.status === TradeSelectionStatus.CANCELLATION_PENDING) {
      return {
        kind: "transition",
        message: `${liveSelection.tradieName}'s cancellation for ${trade} is waiting on an admin. Book again once it is approved.`,
      };
    }
    if (liveSelection.tradieId !== input.tradieId) {
      return {
        kind: "transition",
        message: `${liveSelection.tradieName} is already selected for ${trade}. Request their cancellation before booking ${tradieName}.`,
      };
    }
  }
  const rival = approvedRival(input.milestoneIds, input.others, trade);
  if (rival) {
    return {
      kind: "transition",
      message: `${rival.tradieName} is already ${STATUS_WORDS[rival.status]} for ${rival.milestoneName ?? "this trade"}. Remove that booking before booking ${tradieName}.`,
    };
  }
  return null;
}

/** Booked directly and not yet through the admin's approval. */
const BOOKED_UNAPPROVED_STATUSES: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.PENDING,
  TradieScheduleStatus.PENDING_RESPONSE,
  TradieScheduleStatus.NO_RESPONSE,
];

/**
 * What recording a quote on this booking does.
 *
 * - `quote`: the tradie was asked to quote. The amount lands and the booking
 *   moves to QUOTE_RECEIVED, ready to be compared and selected.
 * - `price`: the tradie was booked without a quote. The amount lands and the
 *   booking stays where it is — it is not in a comparison, and moving a
 *   confirmed booking back to "quote received" would undo the confirmation.
 *   Allowed until the booking is approved, and after that only while it still
 *   has no price: filling in a missing amount is not changing an approved one.
 * - `locked`: an approved price is the admin's to change, not a form's.
 *
 * "Booked without a quote" is the request it came from, when there was one,
 * and otherwise a booking never asked to quote and never priced.
 */
export type QuoteEntry = "quote" | "price" | "locked";

export function quoteEntryFor(booking: {
  readonly status: TradieScheduleStatus;
  readonly quotedPrice: string | null;
  readonly requiresQuote: boolean;
  readonly requestKind: TradieRequestKind | null;
}): QuoteEntry {
  if (QUOTABLE_STATUSES.includes(booking.status)) return "quote";
  if (INACTIVE_SCHEDULE_STATUSES.includes(booking.status)) return "locked";
  const bookedDirectly =
    booking.requestKind === TradieRequestKind.BOOKING
    || (booking.requestKind === null && !booking.requiresQuote);
  if (!bookedDirectly) return "locked";
  if (BOOKED_UNAPPROVED_STATUSES.includes(booking.status)) return "price";
  return booking.quotedPrice ? "locked" : "price";
}

/**
 * The other tradies' bookings a selection cancels: open, in the same trade,
 * on one of the selected tradie's activities.
 */
export function bookingsDisplacedBySelection<
  T extends Pick<SelectionBooking, "status" | "milestoneId" | "trade">,
>(
  own: readonly (Pick<SelectionBooking, "status" | "milestoneId"> & {
    /** Omitted for bookings about to be made in `trade`. */
    readonly trade?: string;
  })[],
  others: readonly T[],
  trade: string,
): T[] {
  const milestoneIds = new Set(
    own
      .filter(
        (booking) =>
          !INACTIVE_SCHEDULE_STATUSES.includes(booking.status)
          && (booking.trade === undefined || sameTrade(booking.trade, trade)),
      )
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
