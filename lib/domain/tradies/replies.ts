import { TradieScheduleStatus, type TradieSchedule } from "@prisma/client";

import type { DomainDb } from "../db";

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

/**
 * Find the one booking this reply answers, or say why there is not one.
 *
 * The date and address the model extracted are *hints*, used only when they
 * are usable and only to narrow the tradie's open bookings — never to widen
 * them. With no usable hint, a tradie with exactly one open booking is
 * answering that one. More than one and nothing to tell them apart is
 * `ambiguous`: guessing would confirm a tradie onto the wrong site, which is
 * worse than asking the office.
 */
export async function matchTradieReplyToSchedule(
  input: { readonly tradieId: string; readonly hints: TradieReplyHints },
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
