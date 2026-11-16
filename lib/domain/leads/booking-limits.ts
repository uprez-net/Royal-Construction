import { OutboxEventKind } from "@prisma/client";

import type { DomainDb } from "../db";

// Abuse controls for the public consultation booking route (#322).
//
// The route is open by design, and each accepted booking takes a real slot on
// the company calendar and makes the company mailbox send an invitation to an
// address the caller chose. Because a busy slot blocks genuine clients, a loop
// of bookings does not just add noise: it removes the business's availability.
//
// The bookings already have a durable record, the CONSULTATION_BOOKING outbox
// row each one claims before the calendar is touched, so the limits are counts
// over that table. That survives serverless instances, unlike a counter held
// in memory, and needs no new column. They are deliberately generous: this
// business books a handful of consultations a week, so a person never meets
// them, and a script meets them within minutes.

export const BOOKING_LIMITS = {
  /** One address cannot book more than this in a day. */
  perEmailPerDay: 3,
  /** Across everyone: the cap that holds when the attacker rotates addresses. */
  perHour: 6,
  perDay: 20,
} as const;

export type BookingCounts = {
  readonly email: number;
  readonly lastHour: number;
  readonly lastDay: number;
};

/** Why a booking is refused, or null when it is within the limits. */
export function bookingLimitReached(counts: BookingCounts): string | null {
  if (counts.email >= BOOKING_LIMITS.perEmailPerDay) {
    return "That email address has made several bookings today. Please call us to arrange another.";
  }
  if (
    counts.lastHour >= BOOKING_LIMITS.perHour
    || counts.lastDay >= BOOKING_LIMITS.perDay
  ) {
    return "We are receiving a lot of bookings right now. Please try again later, or call us.";
  }
  return null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Whether this booking may go ahead.
 *
 * A resubmission of a booking that is already recorded (a double-click, a retry
 * after a timeout) is let through whatever the counts say: it answers with the
 * first attempt's meeting rather than making another, so it costs nothing.
 */
export async function checkBookingLimits(
  db: DomainDb,
  booking: { key: string; email: string; now?: Date },
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const now = booking.now ?? new Date();
  const email = booking.email.trim().toLowerCase();

  const existing = await db.outboxEvent.findUnique({
    where: { key: booking.key },
    select: { id: true },
  });
  if (existing) return { allowed: true };

  const since = (ms: number) => new Date(now.getTime() - ms);
  const bookings = (windowMs: number, byEmail?: string) =>
    db.outboxEvent.count({
      where: {
        kind: OutboxEventKind.CONSULTATION_BOOKING,
        createdAt: { gte: since(windowMs) },
        ...(byEmail === undefined
          ? {}
          : { payload: { path: ["email"], equals: byEmail } }),
      },
    });

  const [forEmail, lastHour, lastDay] = await Promise.all([
    bookings(DAY_MS, email),
    bookings(HOUR_MS),
    bookings(DAY_MS),
  ]);

  const message = bookingLimitReached({
    email: forEmail,
    lastHour,
    lastDay,
  });
  return message === null ? { allowed: true } : { allowed: false, message };
}

/**
 * A caller-supplied name, made safe to put in a calendar subject and an
 * invitation: control characters and line breaks removed, whitespace collapsed,
 * and cut to a length no real name needs. It is still the caller's word, only
 * no longer able to carry a second line of text or a page of it.
 */
export const MAX_BOOKING_NAME_LENGTH = 60;

export function calendarSafeName(name: string): string {
  const cleaned = name
    // Control characters, and the Unicode line and paragraph separators.
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_BOOKING_NAME_LENGTH).trim() || "Client";
}
