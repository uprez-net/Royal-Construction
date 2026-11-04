import { OutboxEventKind } from "@prisma/client";

import type { TransactionalDomainDb } from "../db";
import { DomainValidationError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { DomainPrincipal } from "../principal";

// Booking a consultation from the public website.
//
// This route is on the open internet with no session, which is the category
// AGENTS.md says the shared-admin argument gives no cover at all. Two things
// were missing:
//
//   1. Nothing made the booking idempotent. The calendar conflict check is the
//      real guard against double-booking a slot, but it only sees events that
//      already exist — two submissions of the same form, a double-click or a
//      retry after a timeout, both passed it and both created a Teams meeting
//      and sent the client an invitation.
//
//   2. The calendar event and the lead record were committed separately. When
//      the lead write failed the route answered 500, so the client saw an
//      error AND had a meeting in their diary that the office had no record
//      of. Nobody here watches logs; the first sign would be a builder not
//      turning up.
//
// The durable intent fixes both: it is claimed before the calendar is touched
// and completed only once the lead work is done, so a replay answers with the
// same meeting rather than creating a second one, and a half-finished booking
// is a row somebody can find instead of a silent divergence.

export type ConsultationSlot = {
  /** The real instant the slot starts, not the Sydney wall clock carried as UTC. */
  readonly startsAt: Date;
  readonly email: string;
  readonly name: string;
};

export type BookedConsultation = {
  readonly joinUrl: string | null;
  readonly leadId: number | null;
  /**
   * Whether the client was sent their confirmation. For an online meeting the
   * Teams invitation is the confirmation, so this is true once the event
   * exists. For an in-person meeting it is a separate email, and false means
   * the meeting is booked but the client has not been told where to go.
   */
  readonly confirmationSent: boolean;
};

/**
 * The idempotency key for one booking attempt.
 *
 * Scoped to the exact slot and the email that asked for it, so a resubmission
 * of the same form is one booking while a genuine second consultation — a
 * different time, or a different person — is its own. Deliberately not scoped
 * to the day, unlike the reminder keys: a booking IS a specific instant, so
 * the instant is the natural identity.
 */
export function consultationBookingKey(slot: ConsultationSlot): string {
  const email = slot.email.trim().toLowerCase();
  if (!email) {
    throw new DomainValidationError(
      "A booking needs the client's email address.",
      "email",
    );
  }
  if (Number.isNaN(slot.startsAt.getTime())) {
    throw new DomainValidationError(
      "The requested appointment time is invalid.",
      "startDateTime",
    );
  }
  return `consultation:${slot.startsAt.toISOString()}:${email}`;
}

/**
 * Run one booking behind its durable intent.
 *
 * `book` does the calendar call and the lead work together; whatever it
 * returns is what a replay answers with, so the second submission hands back
 * the first one's join URL instead of making another meeting.
 *
 * The principal is taken and not checked: this route is open by design. What
 * the caller must not do is claim an existing lead it cannot prove it owns,
 * and that check belongs at the route, where the booking token is.
 */
export async function bookConsultation(
  principal: DomainPrincipal,
  slot: ConsultationSlot,
  db: TransactionalDomainDb,
  book: () => Promise<BookedConsultation>,
): Promise<BookedConsultation & { alreadyBooked: boolean }> {
  void principal;
  const key = consultationBookingKey(slot);

  const { replayed, result } = await runOutboxEffectWithOutcome(
    db,
    {
      key,
      kind: OutboxEventKind.CONSULTATION_BOOKING,
      payload: {
        email: slot.email.trim().toLowerCase(),
        name: slot.name,
        startsAt: slot.startsAt.toISOString(),
      },
    },
    async () => {
      const booked = await book();
      return {
        confirmationSent: booked.confirmationSent,
        joinUrl: booked.joinUrl,
        leadId: booked.leadId,
      };
    },
  );

  return {
    alreadyBooked: replayed,
    // A booking recorded before this field existed was always an online one,
    // confirmed by its invitation, so a missing value on replay means sent.
    confirmationSent: result.confirmationSent !== false,
    joinUrl: result.joinUrl,
    leadId: result.leadId,
  };
}
