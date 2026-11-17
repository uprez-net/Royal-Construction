import type { TradieApprovalActionType } from "@prisma/client";

import { sydneyDateOnly } from "@/lib/dates/sydney";
import type { ApprovalDueKind } from "@/types/tradie";

/**
 * The approval queue's order, overdue flag and "due this week" figure. The list
 * and the KPI both call this module, so the number on the tile is the number of
 * rows the filter shows. Pure: no Prisma, no Next. The caller supplies `today`
 * (a Sydney YYYY-MM-DD) and, for a trade cancellation, the earliest open booking.
 */

export const DUE_WEEK_DAYS = 7;

export interface DueSubject {
  id: string;
  actionType: TradieApprovalActionType;
  createdAt: Date;
  updationData: unknown;
}

export interface DueFields {
  decisionDue: string;
  dueKind: ApprovalDueKind;
  overdue: boolean;
}

export type Queued = DueFields & { id: string; createdAt: Date };

/** Calendar arithmetic on YYYY-MM-DD. Never adds milliseconds, so DST cannot move it. */
export function addCalendarDays(day: string, days: number): string {
  return new Date(utcMidnight(day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** The Sydney date of a stored booking instant. Null when it does not parse. */
export function bookingDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return sydneyDateOnly(instant);
}

/** The project a trade cancellation is for; the key the open-booking lookup uses. */
export function tradeCancellationProjectId(payload: unknown): string | null {
  const projectId = field(payload, "projectId");
  return typeof projectId === "string" && projectId ? projectId : null;
}

/** The key a tradie, project and trade are looked up by, for open bookings. */
export function openBookingKey(
  tradieId: string,
  projectId: string,
  trade = "",
): string {
  return `${tradieId}\u0000${projectId}\u0000${trade.trim().toLowerCase()}`;
}

/**
 * The date a request must be decided by. A booking's own date for the two
 * schedule actions, and the earliest open booking the tradie holds on the
 * project for a trade cancellation. Everything else, and any of those with no
 * usable date, falls back to when the request was made.
 */
export function dueFields(
  subject: DueSubject,
  today: string,
  earliestOpenBooking: string | null,
): DueFields {
  let booking: string | null = null;
  if (
    subject.actionType === "SCHEDULE_APPROVAL"
    || subject.actionType === "SCHEDULE_DELETION"
  ) {
    booking = bookingDay(field(subject.updationData, "scheduledDate"));
  } else if (subject.actionType === "TRADE_CANCELLATION") {
    booking = earliestOpenBooking;
  }
  if (booking) {
    return {
      decisionDue: booking,
      dueKind: "booking",
      overdue: booking < today,
    };
  }
  return {
    decisionDue: sydneyDateOnly(subject.createdAt),
    dueKind: "submitted",
    overdue: false,
  };
}

/** Oldest-asked first among equal due dates, then id, so a reload keeps the order. */
function byCreatedThenId(
  a: { id: string; createdAt: Date },
  b: { id: string; createdAt: Date },
): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Needs-decision order: decisionDue ascending (overdue first), then createdAt ascending. */
export function compareNeedsDecision(a: Queued, b: Queued): number {
  if (a.decisionDue !== b.decisionDue) {
    return a.decisionDue < b.decisionDue ? -1 : 1;
  }
  return byCreatedThenId(a, b);
}

/** Booking-based and due on or before Sydney today + 7. Overdue is included. */
export function isDueThisWeek(row: DueFields, today: string): boolean {
  return (
    row.dueKind === "booking"
    && row.decisionDue <= addCalendarDays(today, DUE_WEEK_DAYS)
  );
}

/** The longest-waiting request among those given, with its age in Sydney days. */
export function oldestWaiting<
  T extends {
    id: string;
    actionType: TradieApprovalActionType;
    createdAt: Date;
  },
>(
  rows: readonly T[],
  today: string,
): {
  approvalId: string;
  actionType: TradieApprovalActionType;
  days: number;
} | null {
  let oldest: T | null = null;
  for (const row of rows) {
    if (!oldest || byCreatedThenId(row, oldest) < 0) oldest = row;
  }
  if (!oldest) return null;
  return {
    approvalId: oldest.id,
    actionType: oldest.actionType,
    days: Math.max(
      0,
      calendarDaysBetween(sydneyDateOnly(oldest.createdAt), today),
    ),
  };
}

/**
 * Requests resolved in their review window, never in one click: an incident
 * needs a written resolution, and approving a tradie removal cancels every
 * open booking that tradie holds, which the window makes the office confirm.
 */
export function needsReviewWindow(approval: { actionType: string }): boolean {
  return (
    approval.actionType === "INCIDENT_RESOLUTION"
    || approval.actionType === "TRADIE_REMOVAL"
  );
}

/** The parts of a list query that decide which rows it returns. */
type ListQuery = {
  view: string;
  type?: string;
  due?: string;
  search?: string;
  page: number;
};

/**
 * Whether two queries ask for the same rows. A list result is applied only
 * when it answers the query on screen now: a reload for a view the office has
 * since left must not land under the new one.
 */
export function sameListQuery(a: ListQuery, b: ListQuery): boolean {
  return (
    a.view === b.view
    && a.type === b.type
    && a.due === b.due
    && (a.search ?? "") === (b.search ?? "")
    && a.page === b.page
  );
}

/**
 * After the newest list request fails: true when the rows on screen answer a
 * different query (or none recorded), so the list must be fetched again.
 * Otherwise a view switch superseded by a failed reload left the old view's
 * rows under the new view's tabs (issue #527).
 */
export function staleRowsAfterFailedReload(
  rowsQuery: ListQuery | null,
  query: ListQuery,
): boolean {
  return rowsQuery === null || !sameListQuery(rowsQuery, query);
}
