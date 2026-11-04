import { TradieScheduleStatus } from "@prisma/client";
import { differenceInDays } from "date-fns";

import { isTradieAlertLive, type AlertBooking } from "./alert-rules";
import { INACTIVE_SCHEDULE_STATUSES } from "./lifecycle";
import {
  requestEmailNeedsAttention,
  type RequestDeliveryState,
} from "./request-delivery";

// Which tradie bookings need somebody, and what that somebody should do.
//
// The project page asked this twice and got two answers. The Alerts card
// above the tabs listed confirmed bookings and bookings whose milestone was
// due, each with a "send reminder" bell — including bookings the tradie had
// already confirmed, where the Tradies tab disables that same bell. The
// attention card inside the tab listed unanswered, declined and unapproved
// bookings, each with one "Review" button that opened the status dialog —
// which cannot book a replacement for a declined tradie or approve anything.
// So the same booking could be on one list and not the other, and where it
// was on both, the two buttons did different things.
//
// One answer now, with the one action that deals with it. `isTradieAlertLive`
// still decides whether an alert is over; this decides what it says and what
// it asks for. Pure, so both cards call it on the payload they already hold.

/** The one control an alert carries. */
export type TradieAttentionAction =
  /** Email the tradie (the reminder dialog). */
  | "remind"
  /** The booking is in the admin approval queue. */
  | "approve"
  /** The tradie is not coming; book someone else. */
  | "replace"
  /** The request email did not go; send it again. */
  | "retry-email";

export type TradieAttentionKind =
  | "no-response"
  | "declined"
  | "removed"
  | "final-confirmation"
  | "admin-approval"
  | "follow-up"
  | "request-email-failed";

export type TradieAttention = {
  readonly kind: TradieAttentionKind;
  readonly tone: "danger" | "warning";
  readonly action: TradieAttentionAction;
};

export type AttentionBooking = AlertBooking & {
  readonly reminderSentAt: Date | string | null;
};

export type ReminderTone = "success" | "warning" | "neutral";

/**
 * How the booking's reminder stands: settled, fine for now, or due a chase.
 *
 * The coordination board colours its "1-week reminder" cell with this, and
 * `tradieAttention` raises a follow-up from it, so the cell and the alert
 * cannot disagree about whether a booking needs chasing.
 */
export function reminderTone(
  booking: Pick<
    AttentionBooking,
    "status" | "scheduledDate" | "reminderSentAt"
  >,
  now: Date,
): ReminderTone {
  switch (booking.status) {
    case TradieScheduleStatus.COMPLETED:
    case TradieScheduleStatus.CONFIRMED:
      return "success";
    case TradieScheduleStatus.PENDING_FINAL_CONFIRMATION:
    case TradieScheduleStatus.DECLINED:
      return "warning";
    case TradieScheduleStatus.CANCELLED:
      return "neutral";
  }

  const daysUntilScheduled = differenceInDays(
    new Date(booking.scheduledDate),
    now,
  );
  if (daysUntilScheduled <= 7) return "warning";

  if (!booking.reminderSentAt) {
    return booking.status === TradieScheduleStatus.NO_RESPONSE
      ? "warning"
      : "neutral";
  }

  const daysSinceReminder = differenceInDays(
    now,
    new Date(booking.reminderSentAt),
  );
  // Recently reminded, with runway left.
  if (daysSinceReminder <= 3) return "success";
  // The reminder has gone stale.
  if (daysSinceReminder > 7) return "warning";
  return "neutral";
}

/**
 * What a booking needs, or `null` when it needs nothing.
 *
 * @param today Sydney calendar date, YYYY-MM-DD — `isTradieAlertLive`'s.
 * @param now The instant the reminder arithmetic counts days from.
 */
export function tradieAttention(
  booking: AttentionBooking,
  projectBookings: readonly AlertBooking[],
  today: string,
  now: Date,
): TradieAttention | null {
  if (!isTradieAlertLive(booking, projectBookings, today)) return null;

  switch (booking.status) {
    case TradieScheduleStatus.NO_RESPONSE:
      return { action: "remind", kind: "no-response", tone: "danger" };
    case TradieScheduleStatus.DECLINED:
      return { action: "replace", kind: "declined", tone: "danger" };
    case TradieScheduleStatus.CANCELLED:
      return { action: "replace", kind: "removed", tone: "danger" };
    case TradieScheduleStatus.PENDING_FINAL_CONFIRMATION:
      return {
        action: "remind",
        kind: "final-confirmation",
        tone: "warning",
      };
    case TradieScheduleStatus.AWAITING_ADMIN_APPROVAL:
      // The tradie has answered; chasing them again is the wrong button, and
      // the board disables it. What is outstanding is the office's decision,
      // and it becomes pressing in the last week.
      return differenceInDays(new Date(booking.scheduledDate), now) <= 7
        ? { action: "approve", kind: "admin-approval", tone: "warning" }
        : null;
  }

  return reminderTone(booking, now) === "warning"
    ? { action: "remind", kind: "follow-up", tone: "warning" }
    : null;
}

/**
 * Every booking on a project that needs attention, most urgent first: danger
 * before warning, then the soonest booking.
 */
export function tradieAttentionItems<T extends AttentionBooking>(
  bookings: readonly T[],
  today: string,
  now: Date,
): { readonly booking: T; readonly attention: TradieAttention }[] {
  return bookings
    .flatMap((booking) => {
      const attention = tradieAttention(booking, bookings, today, now);
      return attention ? [{ attention, booking }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.attention.tone === "danger")
          - Number(a.attention.tone === "danger")
        || new Date(a.booking.scheduledDate).getTime()
          - new Date(b.booking.scheduledDate).getTime(),
    );
}

/**
 * Request emails that need a person: failed, or an automatic retry that never
 * ran. One alert per email, not per booking — one email asked for every
 * activity in it — carried on the soonest of its bookings still open.
 *
 * Not dismissible on purpose: it goes away when the email is sent. A request
 * nobody received is the silent failure this exists to stop.
 */
export function requestEmailAttentionItems<
  T extends {
    readonly status: TradieScheduleStatus;
    readonly scheduledDate: Date | string;
    readonly requestRecipient?:
      | (RequestDeliveryState & { readonly id: string })
      | null;
  },
>(
  bookings: readonly T[],
  now: Date,
): { readonly booking: T; readonly attention: TradieAttention }[] {
  const byEmail = new Map<string, T>();
  for (const booking of bookings) {
    const email = booking.requestRecipient;
    if (!email || INACTIVE_SCHEDULE_STATUSES.includes(booking.status)) continue;
    if (!requestEmailNeedsAttention(email, now)) continue;
    const held = byEmail.get(email.id);
    if (
      !held
      || new Date(booking.scheduledDate) < new Date(held.scheduledDate)
    ) {
      byEmail.set(email.id, booking);
    }
  }
  return [...byEmail.values()].map((booking) => ({
    attention: {
      action: "retry-email",
      kind: "request-email-failed",
      tone: "danger",
    },
    booking,
  }));
}
