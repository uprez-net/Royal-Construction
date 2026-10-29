/**
 * Tradie activity log template registry.
 *
 * The tradie's own audit trail, built the way notifications
 * (`types/notification.ts`) and the project activity log
 * (`types/activityLog.ts`) are:
 * - every type has a Zod schema (`utils/validators/tradieActivityLog.ts`);
 * - every type has a template here that turns a validated payload into the
 *   sentence the tradie's page shows;
 * - `createTradieActivityLogEntry()` is the one way to make an entry.
 *
 * Messages do not name the project or the activity: the entry links to both,
 * and the page shows them beside it, so a rename reads correctly everywhere.
 */
import { TradieScheduleStatus } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

// Straight from the schema file, not the `utils/validators` barrel: the
// domain writes these entries, and the barrel reaches `next/server`.
import { tradieActivityLogSchemas } from "@/utils/validators/tradieActivityLog";

/** The `via` the tradie-reminder cron writes under; it runs as no principal. */
export const TRADIE_REMINDER_CRON = "cron:tradie-reminders";

/** Union of every supported tradie activity type. */
export type TradieActivityLogType = keyof typeof tradieActivityLogSchemas;

/** Each type's validated payload, inferred from its schema. */
export type TradieActivityLogDataMap = {
  [K in TradieActivityLogType]: z.infer<(typeof tradieActivityLogSchemas)[K]>;
};

/** A rendered entry, ready to be written. */
export type TradieActivityLogEntry = {
  id: string;
  type: TradieActivityLogType;
  message: string;
  timestamp: string;
  tradieId: string;
  projectId?: string | null;
  milestoneId?: string | null;
  scheduleId?: string | null;
};

type TradieActivityLogTemplateFactory = {
  [K in TradieActivityLogType]: (
    data: TradieActivityLogDataMap[K],
  ) => Omit<TradieActivityLogEntry, "id" | "timestamp" | "type">;
};

/** A booking status as the office says it. */
const STATUS_WORDS: Record<TradieScheduleStatus, string> = {
  [TradieScheduleStatus.PENDING]: "waiting on the tradie",
  [TradieScheduleStatus.AWAITING_QUOTE]: "awaiting quote",
  [TradieScheduleStatus.QUOTE_RECEIVED]: "quote received",
  [TradieScheduleStatus.PENDING_RESPONSE]: "awaiting response",
  [TradieScheduleStatus.NO_RESPONSE]: "no response",
  [TradieScheduleStatus.AWAITING_ADMIN_APPROVAL]:
    "availability confirmed, awaiting admin approval",
  [TradieScheduleStatus.PENDING_FINAL_CONFIRMATION]:
    "approved, awaiting final confirmation",
  [TradieScheduleStatus.CONFIRMED]: "confirmed",
  [TradieScheduleStatus.DECLINED]: "declined",
  [TradieScheduleStatus.COMPLETED]: "completed",
  [TradieScheduleStatus.CANCELLED]: "cancelled",
};

/** The system principals that change bookings, as the office says them. */
const VIA_WORDS: Record<string, string> = {
  "graph:tradie-email-reply": "from the tradie's emailed reply",
  "workflow:tradie-request-retry": "by the automatic retry",
  "xero:bill-webhook": "from Xero",
  [TRADIE_REMINDER_CRON]: "by the daily reminder run",
};

/** " — from the tradie's emailed reply", or nothing when a person did it. */
function via(reason: string | null | undefined): string {
  if (!reason) return "";
  return ` — ${VIA_WORDS[reason] ?? "automatically"}`;
}

/** "Tue 3 Nov 2026" for a `YYYY-MM-DD` (or ISO) day. */
function day(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
        weekday: "short",
        year: "numeric",
      });
}

function days(count: number): string {
  return `${count} day${count === 1 ? "" : "s"}`;
}

const bookingRef = (data: {
  tradieId: string;
  projectId: string;
  scheduleId: string;
  milestoneId?: string | null;
}) => ({
  milestoneId: data.milestoneId ?? null,
  projectId: data.projectId,
  scheduleId: data.scheduleId,
  tradieId: data.tradieId,
});

export const tradieActivityLogTemplates: TradieActivityLogTemplateFactory = {
  bookingCreated: (data) => ({
    ...bookingRef(data),
    message: `${data.asksForQuote ? "Asked to quote for" : "Booked directly for"} ${data.trade} · starts ${day(data.scheduledDate)} · ${days(data.durationDays)}${via(data.via)}`,
  }),

  bookingStatusChanged: (data) => ({
    ...bookingRef(data),
    message: `Booking moved from ${STATUS_WORDS[data.from]} to ${STATUS_WORDS[data.to]}${data.quote ? ` · quoted ${data.quote}` : ""}${via(data.via)}`,
  }),

  bookingRescheduled: (data) => ({
    ...bookingRef(data),
    message: `Rescheduled from ${day(data.previousDate)} (${days(data.previousDurationDays)}) to ${day(data.scheduledDate)} (${days(data.durationDays)})${via(data.via)}`,
  }),

  bookingCancelled: (data) => ({
    ...bookingRef(data),
    message: `Booking cancelled: ${data.reason}${via(data.via)}`,
  }),

  bookingCompleted: (data) => ({
    ...bookingRef(data),
    message: `Booking completed: ${data.reason}${via(data.via)}`,
  }),

  bookingDeletionRequested: (data) => ({
    ...bookingRef(data),
    message: `Removal of the booking requested: ${data.reason}${via(data.via)}`,
  }),

  bookingDeleted: (data) => ({
    ...bookingRef(data),
    message: `Booking${data.scheduledDate ? ` for ${day(data.scheduledDate)}` : ""} removed after admin approval${via(data.via)}`,
  }),

  quoteRecorded: (data) => ({
    ...bookingRef(data),
    message: data.priceOnly
      ? `Price of ${data.amount} recorded for a direct booking; the booking kept its status${via(data.via)}`
      : `Quote of ${data.amount} recorded by the office${via(data.via)}`,
  }),

  invoiceRecorded: (data) => ({
    ...bookingRef(data),
    message: `Invoice${data.invoiceNumber ? ` ${data.invoiceNumber}` : ""} for ${data.amount} ex GST ${data.source === "XERO" ? "received from Xero" : "recorded by the office"}${via(data.via)}`,
  }),

  invoiceAllocated: (data) => ({
    ...bookingRef(data),
    message: `Invoice${data.invoiceNumber ? ` ${data.invoiceNumber}` : ""} for ${data.amount} ex GST allocated to this booking${via(data.via)}`,
  }),

  invoiceVoided: (data) => ({
    ...bookingRef(data),
    message: `Invoice${data.invoiceNumber ? ` ${data.invoiceNumber}` : ""} for ${data.amount} ex GST voided: ${data.reason}${via(data.via)}`,
  }),

  requestEmailSent: (data) => ({
    projectId: data.projectId,
    tradieId: data.tradieId,
    message: `Request email sent to ${data.to}${data.attempt > 1 ? ` on attempt ${data.attempt}` : ""}${via(data.via)}`,
  }),

  requestEmailNotSent: (data) => ({
    projectId: data.projectId,
    tradieId: data.tradieId,
    message: `Request email to ${data.to} not sent: ${data.reason}${via(data.via)}`,
  }),

  bookingEmailSent: (data) => ({
    ...bookingRef(data),
    message: `Email sent: "${data.subject}"${via(data.via)}`,
  }),

  selectedForTrade: (data) => ({
    projectId: data.projectId,
    tradieId: data.tradieId,
    message: data.fromQuote
      ? `Quote selected: chosen for ${data.trade}`
      : `Booked directly: chosen for ${data.trade}`,
  }),

  tradeCancellationRequested: (data) => ({
    projectId: data.projectId,
    tradieId: data.tradieId,
    message: `Cancellation from ${data.trade} requested: ${data.reason}`,
  }),

  tradeCancellationResolved: (data) => ({
    projectId: data.projectId,
    tradieId: data.tradieId,
    message: data.approved
      ? `Released from ${data.trade}; ${data.cancelledBookings} open booking${data.cancelledBookings === 1 ? "" : "s"} cancelled`
      : `Cancellation from ${data.trade} rejected; still selected`,
  }),

  removedFromDirectory: (data) => ({
    tradieId: data.tradieId,
    message: `Removed from the directory; ${data.cancelledBookings} open booking${data.cancelledBookings === 1 ? "" : "s"} cancelled`,
  }),

  incidentReported: (data) => ({
    tradieId: data.tradieId,
    message: `Incident reported: ${data.incidentType.toLowerCase()}, ${data.severity.toLowerCase()} severity`,
  }),

  incidentResolved: (data) => ({
    tradieId: data.tradieId,
    message: `Incident resolved: ${data.resolution}`,
  }),

  outlookEmailSent: (data) => ({
    tradieId: data.tradieId,
    message: `Emailed from Outlook: "${data.subject}"`,
  }),
};

/**
 * Creates a validated tradie activity-log entry.
 *
 * The payload is validated against its type's schema, then rendered by its
 * template into an entry with a fresh id and timestamp.
 *
 * @throws {ZodError} when the payload does not satisfy the type's schema.
 */
export const createTradieActivityLogEntry = <T extends TradieActivityLogType>(
  type: T,
  data: TradieActivityLogDataMap[T],
): TradieActivityLogEntry => {
  const validated = tradieActivityLogSchemas[type].parse(
    data,
  ) as TradieActivityLogDataMap[T];
  return {
    ...tradieActivityLogTemplates[type](validated),
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
  };
};
