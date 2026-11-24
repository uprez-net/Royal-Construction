import { OfferStatus, OutboxEventKind, Prisma } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import { SYDNEY_TZ } from "@/lib/dates/sydney";

import { leadListScope } from "../access/leads";
import { authorizeOffer } from "../access/offers";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { allowedLeadRecipients } from "../leads/email";
import { runOutboxEffectWithOutcome } from "../outbox";
import {
  attributionUserId,
  isOfficePrincipal,
  type DomainPrincipal,
} from "../principal";

// Following up an offer the client has not answered (issue #449).
//
// **Nothing is scheduled.** The 24-hour timer the issue asks for is a fact
// about two timestamps — when the client was last contacted and now — so it is
// read, not run: an offer becomes due a day after it went out, or a day after
// the last follow-up, and stops being due the moment it is answered, accepted,
// declined or superseded. There is no job to fail at 3am, no row to clean up
// when the client signs, and no way for the alert and the offer's real state
// to disagree.
//
// **Nothing is sent by the button.** "Do follow-up" opens a draft; the email
// leaves only when the administrator presses Send on it, through
// `sendOfferFollowUp` below, once per attempt.

/**
 * The statuses in which an offer is with the client and waiting on them.
 *
 * SENT is the proposal emailed for review; OFFER_SENT is the acceptance out
 * for signature. Everything after is past the offer — the client has agreed,
 * and the tender and contract have their own DocuSign reminders — and
 * everything rejected, declined or superseded is closed.
 */
export const OFFER_AWAITING_RESPONSE_STATUSES: readonly OfferStatus[] = [
  OfferStatus.SENT,
  OfferStatus.OFFER_SENT,
];

/** How long after the last contact an unanswered offer is due a follow-up. */
export const FOLLOW_UP_AFTER_HOURS = 24;
const FOLLOW_UP_AFTER_MS = FOLLOW_UP_AFTER_HOURS * 60 * 60 * 1000;

export type OfferFollowUpState =
  /** A day or more since the last contact, and no reply since. */
  | "DUE"
  /** Followed up less than a day ago; due again at `nextDueAt`. */
  | "FOLLOWED_UP";

export type OfferFollowUpAlert = {
  readonly offerId: string;
  readonly leadId: number;
  /** "RC-Q-2026-014 · Rev 2", or the lead number for an unreferenced offer. */
  readonly reference: string;
  readonly clientName: string;
  /** The addresses a follow-up may go to, the lead's primary first. */
  readonly clientEmails: string[];
  readonly projectAddress: string | null;
  /** ISO instant the offer was first sent to the client. */
  readonly sentAt: string;
  /** Calendar days, in Sydney, since it was sent. */
  readonly daysPending: number;
  readonly state: OfferFollowUpState;
  readonly followUpCount: number;
  /** ISO instant of the last follow-up, or null when there has been none. */
  readonly lastFollowUpAt: string | null;
  /** ISO instant it is (or was) next due. */
  readonly nextDueAt: string;
};

/** What `assessOfferFollowUp` reads from one offer. */
export type OfferFollowUpSource = {
  readonly offerStatus: OfferStatus;
  /** When the client was first sent the offer. */
  readonly sentAt: Date;
  /** When it entered the status it is waiting in; at least `sentAt`. */
  readonly awaitingSince: Date;
  readonly followUpTimes: readonly Date[];
  /**
   * When the office pressed "Follow-up done": they chased the client some
   * other way (a call, a text). Contact, but not an email from here.
   */
  readonly markedDoneTimes: readonly Date[];
  /** The latest proposal email to the client, re-sends included. */
  readonly lastSentAt: Date | null;
  /** The latest reply from the client to any send of this offer. */
  readonly lastReplyAt: Date | null;
};

function latest(times: readonly (Date | null)[]): Date | null {
  const known = times.filter((at): at is Date => at !== null);
  return known.length > 0
    ? new Date(Math.max(...known.map((at) => at.getTime())))
    : null;
}

/**
 * The last time we contacted the client: the send, a re-send, a follow-up
 * email, or a follow-up the office marked done.
 */
function lastContactOf(offer: OfferFollowUpSource): Date {
  return (
    latest([
      offer.awaitingSince,
      offer.lastSentAt,
      ...offer.followUpTimes,
      ...offer.markedDoneTimes,
    ]) ?? offer.awaitingSince
  );
}

/**
 * The client has answered since we last wrote to them. That is a response,
 * whatever the offer's status says: the alert stops, and a follow-up already
 * open in a draft is refused rather than sent to someone who has replied.
 */
export function clientHasResponded(offer: OfferFollowUpSource): boolean {
  return (
    offer.lastReplyAt !== null && offer.lastReplyAt >= lastContactOf(offer)
  );
}

/**
 * Whether one offer needs following up, and how its alert reads; null when it
 * does not belong on the list at all.
 *
 * Pure, so the rule can be tested at any `now`.
 */
export function assessOfferFollowUp(
  offer: OfferFollowUpSource,
  now: Date,
): Pick<
  OfferFollowUpAlert,
  "state" | "daysPending" | "followUpCount" | "lastFollowUpAt" | "nextDueAt"
> | null {
  if (!OFFER_AWAITING_RESPONSE_STATUSES.includes(offer.offerStatus)) {
    return null;
  }
  const lastFollowUp = latest(offer.followUpTimes);
  const lastContact = lastContactOf(offer);

  // A later send or follow-up of ours restarts the clock.
  if (clientHasResponded(offer)) return null;

  const withinADay = now.getTime() - lastContact.getTime() < FOLLOW_UP_AFTER_MS;

  // Not a day since the offer last went out, and never chased: nothing to
  // say yet.
  if (lastFollowUp === null && withinADay) return null;

  // The office marked it done after the last email: it is off the list until
  // it falls due again, rather than sitting there as "Followed up". A mark is
  // a dismissal, not a closure — a client who still has not answered a day
  // later comes back as due.
  const lastMarkedDone = latest(offer.markedDoneTimes);
  if (
    withinADay
    && lastMarkedDone !== null
    && lastMarkedDone.getTime() === lastContact.getTime()
  ) {
    return null;
  }

  const nextDueAt = new Date(lastContact.getTime() + FOLLOW_UP_AFTER_MS);
  return {
    state: now >= nextDueAt ? "DUE" : "FOLLOWED_UP",
    daysPending: Math.max(
      0,
      differenceInCalendarDays(
        toZonedTime(now, SYDNEY_TZ),
        toZonedTime(offer.sentAt, SYDNEY_TZ),
      ),
    ),
    followUpCount: offer.followUpTimes.length,
    lastFollowUpAt: lastFollowUp?.toISOString() ?? null,
    nextDueAt: nextDueAt.toISOString(),
  };
}

const followUpOfferSelect = {
  id: true,
  leadId: true,
  baseReference: true,
  revisionNumber: true,
  offerStatus: true,
  sentAt: true,
  updatedAt: true,
  lead: {
    select: {
      name: true,
      email: true,
      secondaryEmail: true,
      location: true,
    },
  },
  statusEvents: {
    where: { toStatus: { in: [...OFFER_AWAITING_RESPONSE_STATUSES] } },
    orderBy: { at: "desc" },
    take: 1,
    select: { at: true },
  },
  followUps: { select: { sentAt: true } },
  followUpsDone: { select: { doneAt: true } },
  // Every send, not just the answered ones: a re-sent proposal is contact and
  // restarts the clock, and its token is what a follow-up's reply matches on.
  documentSends: {
    orderBy: { sentAt: "desc" },
    select: {
      sentAt: true,
      lastReplyAt: true,
      recipientEmail: true,
      trackedLinkToken: true,
    },
  },
} satisfies Prisma.OfferSelect;

type FollowUpOfferRow = Prisma.OfferGetPayload<{
  select: typeof followUpOfferSelect;
}>;

/**
 * One offer's row as the follow-up rule reads it. The alert list and the send
 * command both come through here, so they cannot disagree about when the
 * client was last contacted or whether they have answered.
 */
function followUpSource(offer: FollowUpOfferRow): OfferFollowUpSource {
  // `sentAt` is set when the proposal is first emailed. An offer sent for
  // signature without that email has only its status event to go on.
  const awaitingSince =
    offer.statusEvents[0]?.at ?? offer.sentAt ?? offer.updatedAt;
  const sentAt = offer.sentAt ?? awaitingSince;
  return {
    offerStatus: offer.offerStatus,
    sentAt,
    awaitingSince: awaitingSince < sentAt ? sentAt : awaitingSince,
    followUpTimes: offer.followUps.map((followUp) => followUp.sentAt),
    markedDoneTimes: offer.followUpsDone.map((done) => done.doneAt),
    lastSentAt: latest(offer.documentSends.map((send) => send.sentAt)),
    lastReplyAt: latest(offer.documentSends.map((send) => send.lastReplyAt)),
  };
}

/**
 * The addresses a follow-up may go to, the ones the offer was actually emailed
 * to first: a follow-up there carries that send's reply token, so the client's
 * answer is recorded against the offer.
 */
function followUpRecipients(offer: FollowUpOfferRow): string[] {
  const sentTo = new Set(
    offer.documentSends.map((send) => send.recipientEmail.trim().toLowerCase()),
  );
  const allowed = allowedLeadRecipients(offer.lead);
  return [
    ...allowed.filter((email) => sentTo.has(email)),
    ...allowed.filter((email) => !sentTo.has(email)),
  ];
}

const REPLY_TOKEN = /\s*\[RCOFR-[0-9A-Fa-f]{12}\]/g;

/**
 * The subject with the reply token of the send it follows up, so the client's
 * "Re:" is matched to that send by `recordOfferReply`, like a reply to the
 * offer itself. Kept however the administrator edited the subject: a token
 * they removed is put back, and one belonging to another send is replaced.
 */
export function withReplyToken(subject: string, token: string | null): string {
  if (!token || subject.includes(`[${token}]`)) return subject;
  return `${subject.replace(REPLY_TOKEN, "").trim()} [${token}]`;
}

/**
 * Every offer the caller may see that is waiting on the client and due, or
 * recently, followed up. Due first, then longest pending.
 *
 * The active revision only: a superseded revision is not with anybody.
 * `offerIds` assesses only those offers, for a caller that already has its
 * list.
 */
export async function listOfferFollowUpAlerts(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
  options: { readonly offerIds?: readonly string[] } = {},
): Promise<OfferFollowUpAlert[]> {
  const scope = leadListScope(principal);
  const offers = await db.offer.findMany({
    where: {
      ...(options.offerIds ? { id: { in: [...options.offerIds] } } : {}),
      isActive: true,
      offerStatus: { in: [...OFFER_AWAITING_RESPONSE_STATUSES] },
      ...(scope.assignedId === null
        ? {}
        : { lead: { assignedId: scope.assignedId } }),
    },
    select: followUpOfferSelect,
  });

  return offers
    .flatMap((offer): OfferFollowUpAlert[] => {
      const source = followUpSource(offer);
      const assessed = assessOfferFollowUp(source, now);
      if (!assessed) return [];
      return [
        {
          ...assessed,
          offerId: offer.id,
          leadId: offer.leadId,
          reference: offer.baseReference
            ? `${offer.baseReference}${offer.revisionNumber > 1 ? ` · Rev ${offer.revisionNumber}` : ""}`
            : `OF-${offer.leadId}`,
          clientName: offer.lead.name,
          clientEmails: followUpRecipients(offer),
          projectAddress: offer.lead.location,
          sentAt: source.sentAt.toISOString(),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.state === "DUE") - Number(a.state === "DUE")
        || b.daysPending - a.daysPending,
    );
}

/**
 * The offer, if the caller may see it and it is still waiting on the client.
 * Sending a follow-up and marking one done refuse on the same grounds, so the
 * two cannot disagree about whether there is anyone to chase.
 */
async function loadOfferAwaitingClient(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
): Promise<FollowUpOfferRow> {
  await authorizeOffer(principal, offerId, db);
  const offer = await db.offer.findUnique({
    where: { id: offerId },
    select: followUpOfferSelect,
  });
  if (!offer) throw new DomainNotFoundError("Offer not found");
  if (!OFFER_AWAITING_RESPONSE_STATUSES.includes(offer.offerStatus)) {
    throw new DomainTransitionError(
      "This offer is no longer waiting on the client, so there is nothing to follow up.",
    );
  }
  // The same rule that takes the alert off the list: a reply that arrived
  // while the draft was open means there is nobody to chase.
  if (clientHasResponded(followUpSource(offer))) {
    throw new DomainTransitionError(
      "The client has replied since they were last contacted. Read their reply before following up.",
    );
  }
  return offer;
}

export type MarkOfferFollowUpDoneResult = {
  readonly offerId: string;
  /** ISO instant it was marked done. */
  readonly doneAt: string;
  /** ISO instant the alert comes back if the client still has not answered. */
  readonly nextDueAt: string;
};

/**
 * "Follow-up done": the office chased the client some other way — a call, a
 * text — and wants the alert off the Offers page. Nothing is sent.
 *
 * Recorded as contact, so the alert leaves the list and comes back a day later
 * only if the client still has not answered, signed or declined. It is not a
 * permanent dismissal: an offer nobody hears back on is exactly the one the
 * alert exists to keep in front of the office.
 *
 * A double press records two marks a moment apart, which reads the same; no
 * attempt key is needed because nothing leaves the building.
 */
export async function markOfferFollowUpDone(
  principal: DomainPrincipal,
  input: { readonly offerId: string },
  db: DomainDb,
): Promise<MarkOfferFollowUpDoneResult> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Following up an offer requires internal staff access.",
    );
  }
  await loadOfferAwaitingClient(principal, input.offerId, db);
  const done = await db.offerFollowUpDone.create({
    data: {
      offerId: input.offerId,
      doneById: attributionUserId(principal),
    },
    select: { doneAt: true },
  });
  return {
    offerId: input.offerId,
    doneAt: done.doneAt.toISOString(),
    nextDueAt: new Date(
      done.doneAt.getTime() + FOLLOW_UP_AFTER_MS,
    ).toISOString(),
  };
}

export type SendOfferFollowUpInput = {
  readonly offerId: string;
  /** One of the lead's own addresses. */
  readonly to: string;
  readonly subject: string;
  /** The text as the administrator edited it; the adapter renders `html`. */
  readonly body: string;
  /** The rendered message the client receives. */
  readonly html: string;
  /** The browser's Idempotency-Key for this attempt. Required. */
  readonly attemptKey: string;
};

export type OfferFollowUpPorts = {
  readonly sendMail: (message: {
    to: string;
    subject: string;
    body: string;
  }) => Promise<unknown>;
};

export type SendOfferFollowUpResult = {
  readonly followUpId: string;
  readonly sentAt: string;
  readonly to: string;
  /**
   * True when this attempt had already been sent and was not sent again. The
   * adapter must say so rather than report a fresh send.
   */
  readonly replayed: boolean;
};

/**
 * Email the client a follow-up about an offer still waiting on them, once.
 *
 * Refuses, before anything is sent, when the caller is not staff, the offer is
 * no longer waiting on the client, or the address is not one on the lead —
 * the same recipient rule as every other email to a lead, so the company
 * mailbox cannot be pointed at an arbitrary address.
 *
 * Keyed per attempt rather than per day or per body. A derived key is how a
 * second follow-up the office meant to send was reported as sent while nothing
 * left the building; the key here is the one the browser holds for this press
 * of Send, so a double click or a retry is one email, and tomorrow's follow-up
 * is another.
 */
export async function sendOfferFollowUp(
  principal: DomainPrincipal,
  input: SendOfferFollowUpInput,
  db: DomainDb,
  ports: OfferFollowUpPorts,
): Promise<SendOfferFollowUpResult> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Following up an offer requires internal staff access.",
    );
  }
  const attemptKey = input.attemptKey.trim();
  if (!attemptKey) {
    throw new DomainValidationError(
      "This send has no attempt key. Reload the page and try again.",
    );
  }
  const subject = input.subject.trim();
  if (!subject) {
    throw new DomainValidationError("Add a subject line.", "subject");
  }
  if (!input.body.trim()) {
    throw new DomainValidationError("The email is empty.", "body");
  }

  const offer = await loadOfferAwaitingClient(principal, input.offerId, db);

  const to = input.to.trim().toLowerCase();
  if (!allowedLeadRecipients(offer.lead).includes(to)) {
    throw new DomainAuthorizationError(
      "That address is not on this lead. Update the lead's contact details first.",
    );
  }
  // The newest send to this address; its token goes on the subject so the
  // reply is recorded. None when the offer was never emailed there (an
  // acceptance sent only through DocuSign), and a reply is then read in the
  // mailbox, as it always was.
  const priorSend = offer.documentSends.find(
    (send) => send.recipientEmail.trim().toLowerCase() === to,
  );
  const sentSubject = withReplyToken(
    subject,
    priorSend?.trackedLinkToken ?? null,
  );

  const key = `offer-follow-up:${input.offerId}:${attemptKey}`;
  const { replayed, result } = await runOutboxEffectWithOutcome(
    db,
    {
      key,
      kind: OutboxEventKind.OFFER_FOLLOW_UP_SEND,
      payload: { offerId: input.offerId, to },
    },
    async () => {
      try {
        await ports.sendMail({ to, subject: sentSubject, body: input.html });
      } catch (error) {
        // Not retried under the same key: the provider may have accepted a
        // message whose answer never arrived, and a client chased twice is
        // the expensive outcome. Opening the draft again starts a new attempt.
        throw new DomainSideEffectError(
          "The follow-up email may not have been sent. Check Sent Items before sending it again.",
          "email",
          false,
          { cause: error },
        );
      }
      const followUp = await db.offerFollowUp.create({
        data: {
          offerId: input.offerId,
          toAddress: to,
          subject: sentSubject,
          body: input.body,
          attemptKey: key,
          sentById: attributionUserId(principal),
        },
        select: { id: true, sentAt: true },
      });
      return { followUpId: followUp.id, sentAt: followUp.sentAt.toISOString() };
    },
  );

  return {
    followUpId: result.followUpId,
    sentAt: result.sentAt,
    to,
    replayed,
  };
}
