import { TradieScheduleStatus, type TradieSchedule } from "@prisma/client";

import type { DomainDb } from "../db";
import { tradieRefKind } from "./reply-reference";

// Which booking a tradie's emailed reply is about, and what it moves it to.
//
// This used to live inline in the Graph webhook as one exact-match query on
// the date and site address the model read out of the reply. The reply body is
// stripped of the quoted thread before the model sees it, so a tradie who just
// answers "Yes, confirmed" gives it no date at all: the model returned "", the
// webhook passed `new Date("")` to Prisma, and the reply was lost behind a
// validation error logged as a failed *lead* — with nobody watching logs, the
// first sign was a booking that never moved.

/**
 * The bookings a reply can be answering: the ones still waiting on the tradie.
 *
 * The webhook used to accept anything not DECLINED, AWAITING_ADMIN_APPROVAL or
 * CONFIRMED, which let a "yes" land on a COMPLETED booking — one the state
 * machine has no exit from, so the reply failed further down. Dropped here.
 */
export const AWAITING_TRADIE_REPLY: readonly TradieScheduleStatus[] = [
  TradieScheduleStatus.PENDING,
  TradieScheduleStatus.AWAITING_QUOTE,
  TradieScheduleStatus.PENDING_RESPONSE,
  TradieScheduleStatus.QUOTE_RECEIVED,
  TradieScheduleStatus.NO_RESPONSE,
  TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
];

export type TradieReplyHints = {
  /** What the model read as the booking date. Anything, including "". */
  readonly scheduleDate?: string | null;
  /** What the model read as the site address. Anything, including "". */
  readonly projectLocation?: string | null;
};

type Candidate = Pick<TradieSchedule, "id" | "scheduledDate" | "status"> & {
  project: { location: string; name: string };
};

export type TradieReplyMatch =
  | { readonly kind: "matched"; readonly schedule: Candidate }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly Candidate[] };

/** `YYYY-MM-DD` when the hint is a real calendar date, otherwise null. */
function hintDay(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The bookings a reference names: one request email's, or one booking. */
export type TradieReplyScope =
  | { readonly requestRecipientId: string }
  | { readonly scheduleId: string };

export type TradieReplyReference = {
  readonly token: string;
  readonly scope: TradieReplyScope;
  /** The project the referenced email was about. */
  readonly projectId: string;
  readonly projectName: string;
  readonly tradie: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly additionalEmails: readonly string[];
  };
};

/**
 * What a reference quoted in a reply names, or null when it names nothing —
 * a stale thread on a deleted project, or a typo. The caller then treats the
 * message as it would one with no reference.
 */
export async function findTradieReplyReference(
  token: string,
  db: DomainDb,
): Promise<TradieReplyReference | null> {
  const tradie = {
    select: { additionalEmails: true, email: true, id: true, name: true },
  } as const;
  switch (tradieRefKind(token)) {
    case "request": {
      const recipient = await db.tradieRequestRecipient.findUnique({
        select: {
          id: true,
          request: {
            select: { project: { select: { id: true, name: true } } },
          },
          tradie,
        },
        where: { refToken: token },
      });
      return recipient
        ? {
            projectId: recipient.request.project.id,
            projectName: recipient.request.project.name,
            scope: { requestRecipientId: recipient.id },
            token,
            tradie: recipient.tradie,
          }
        : null;
    }
    case "booking": {
      const schedule = await db.tradieSchedule.findUnique({
        select: {
          id: true,
          project: { select: { id: true, name: true } },
          tradie,
        },
        where: { refToken: token },
      });
      return schedule
        ? {
            projectId: schedule.project.id,
            projectName: schedule.project.name,
            scope: { scheduleId: schedule.id },
            token,
            tradie: schedule.tradie,
          }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Was this reply sent from an address the referenced tradie is on file with?
 *
 * The reference picks the tradie, so it must not also be what proves the
 * sender is them: anyone holding a forwarded thread could otherwise confirm a
 * booking or set its price. A reply from another address goes to the office.
 */
export function isReplyFromTradie(
  reference: Pick<TradieReplyReference, "tradie">,
  sender: string | null | undefined,
): boolean {
  const from = sender?.trim().toLowerCase();
  if (!from) return false;
  return [reference.tradie.email, ...reference.tradie.additionalEmails].some(
    (address) => address.trim().toLowerCase() === from,
  );
}

/**
 * The tradie an unreferenced message came from, by any address on their record.
 *
 * Their primary email first, then the extra addresses an office answers from
 * (accounts@, a partner's phone), compared trimmed and lowercased as
 * `isReplyFromTradie` does. An extra address shared by two tradies names
 * neither: the message is then not filed as either's.
 */
export async function findTradieBySender(
  sender: string | null | undefined,
  db: DomainDb,
): Promise<{ readonly id: string; readonly name: string } | null> {
  const from = sender?.trim().toLowerCase() ?? "";
  if (!from) return null;
  // Prisma matches a scalar list case-sensitively only, and stored extras are
  // not always lowercased ("Accounts@ABC.example"), so any tradie with extras
  // is read and compared below. `hasSome` with the sender's own casing missed
  // every other spelling, and with it the second tradie sharing an address,
  // which the shared-address rule below depends on seeing. The directory is a
  // few hundred rows at most; no `take`, for the same reason.
  const candidates = await db.tradie.findMany({
    select: { additionalEmails: true, email: true, id: true, name: true },
    where: {
      OR: [
        { email: { equals: from, mode: "insensitive" } },
        { additionalEmails: { isEmpty: false } },
      ],
    },
  });
  const primary = candidates.find(
    (tradie) => tradie.email.trim().toLowerCase() === from,
  );
  if (primary) return { id: primary.id, name: primary.name };
  const extra = candidates.filter((tradie) =>
    tradie.additionalEmails.some(
      (address) => address.trim().toLowerCase() === from,
    ),
  );
  return extra.length === 1 ? { id: extra[0].id, name: extra[0].name } : null;
}

/**
 * Find the one booking this reply answers, or say why there is not one.
 *
 * With a `scope` — the reply quoted one of our references — only the bookings
 * that reference names are considered. Without one, every booking the tradie
 * has open is.
 *
 * The date and address the model extracted are *hints*, used only when they
 * are usable and only to narrow the tradie's open bookings — never to widen
 * them. With no usable hint, a tradie with exactly one open booking is
 * answering that one. More than one and nothing to tell them apart is
 * `ambiguous`: guessing would confirm a tradie onto the wrong site, which is
 * worse than asking the office.
 */
export async function matchTradieReplyToSchedule(
  input: {
    readonly tradieId: string;
    readonly hints: TradieReplyHints;
    readonly scope?: TradieReplyScope;
  },
  db: DomainDb,
): Promise<TradieReplyMatch> {
  const open: Candidate[] = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      project: { select: { location: true, name: true } },
      scheduledDate: true,
      status: true,
    },
    where: {
      status: { in: [...AWAITING_TRADIE_REPLY] },
      tradieId: input.tradieId,
      ...(input.scope && "scheduleId" in input.scope
        ? { id: input.scope.scheduleId }
        : input.scope
          ? { requestRecipientId: input.scope.requestRecipientId }
          : {}),
    },
  });
  if (open.length === 0) return { kind: "none" };

  let narrowed = open;

  const day = hintDay(input.hints.scheduleDate);
  if (day) {
    const onDay = narrowed.filter(
      (candidate) => candidate.scheduledDate.toISOString().slice(0, 10) === day,
    );
    // A date that matches nothing is a misread, not a reason to drop the
    // reply: the tradie may have mentioned a different day in passing.
    if (onDay.length > 0) narrowed = onDay;
  }

  const location = squash(input.hints.projectLocation ?? "");
  if (location.length >= 4 && narrowed.length > 1) {
    const atSite = narrowed.filter((candidate) => {
      const site = squash(candidate.project.location);
      return site.includes(location) || location.includes(site);
    });
    if (atSite.length > 0) narrowed = atSite;
  }

  return narrowed.length === 1
    ? { kind: "matched", schedule: narrowed[0] }
    : { kind: "ambiguous", candidates: narrowed };
}

/**
 * The bookings one reply to a request email answers, when that email covered
 * several activities and nothing in the reply picks one out.
 *
 * The reference already says the reply is about exactly these bookings, so an
 * answer that means the same for each of them is applied to all:
 *
 *   - a decline: "can't take this one on" turns down the whole email;
 *   - a yes with no price, to bookings that were not asking for a quote: the
 *     tradie confirmed the dates they were sent.
 *
 * Anything else — above all a price — returns null and goes to the office: a
 * single amount for several activities cannot be split by a guess, and the
 * same total written onto each would count it several times over.
 */
export function referencedReplyTargets<
  T extends Pick<TradieSchedule, "status">,
>(
  candidates: readonly T[],
  reply: { readonly confirmed: boolean; readonly quoted: boolean },
): readonly T[] | null {
  if (!reply.confirmed) return candidates;
  if (reply.quoted) return null;
  return candidates.every(
    (candidate) =>
      candidate.status !== TradieScheduleStatus.AWAITING_QUOTE
      && candidate.status !== TradieScheduleStatus.QUOTE_RECEIVED,
  )
    ? candidates
    : null;
}

/**
 * The status a reply moves a booking to.
 *
 * A yes to a final confirmation confirms it; any other yes puts it in front of
 * an admin; a no declines it. Whether that edge exists from the booking's
 * current status is still the transition command's decision.
 */
export function tradieReplyStatus(
  current: TradieScheduleStatus,
  confirmed: boolean,
): TradieScheduleStatus {
  if (!confirmed) return TradieScheduleStatus.DECLINED;
  return current === TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
    ? TradieScheduleStatus.CONFIRMED
    : TradieScheduleStatus.AWAITING_ADMIN_APPROVAL;
}
