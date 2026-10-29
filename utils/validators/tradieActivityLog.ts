import { TradieScheduleStatus } from "@prisma/client";
import { z } from "zod";

// The payload each tradie activity-log entry is written from. One schema per
// type; the template for each lives in types/tradieActivityLog.ts, and
// `createTradieActivityLogEntry` validates against this before rendering.
//
// Kept apart from the `utils/validators` barrel for the same reason the project
// activity-log schemas are: the domain imports these, and the barrel reaches
// `next/server`.

/** What an entry about one booking always carries. */
const booking = {
  tradieId: z.string().min(1),
  projectId: z.string().min(1),
  scheduleId: z.string().min(1),
  milestoneId: z.string().nullish(),
  /**
   * What did it when no person did: a system principal's reason, such as
   * "graph:tradie-email-reply". Absent when someone signed in did it.
   */
  via: z.string().nullish(),
};

const status = z.enum(TradieScheduleStatus);

export const tradieActivityLogSchemas = {
  bookingCreated: z.object({
    ...booking,
    trade: z.string(),
    /** `YYYY-MM-DD`. */
    scheduledDate: z.string(),
    durationDays: z.number().int().positive(),
    /** Asked to quote, rather than booked directly. */
    asksForQuote: z.boolean(),
  }),

  bookingStatusChanged: z.object({
    ...booking,
    from: status,
    to: status,
    /** A price that came with the change, already formatted. */
    quote: z.string().nullish(),
  }),

  bookingRescheduled: z.object({
    ...booking,
    previousDate: z.string(),
    previousDurationDays: z.number().int().positive(),
    scheduledDate: z.string(),
    durationDays: z.number().int().positive(),
  }),

  bookingCancelled: z.object({
    ...booking,
    /** Why, as a sentence fragment: "XYZ Plumbing was selected for Plumbing". */
    reason: z.string().min(1),
  }),

  bookingCompleted: z.object({
    ...booking,
    /** Why, as a sentence fragment: "its last day on site has passed". */
    reason: z.string().min(1),
  }),

  bookingDeletionRequested: z.object({
    ...booking,
    reason: z.string().min(1),
  }),

  bookingDeleted: z.object({
    ...booking,
    /** `YYYY-MM-DD`, from the request: the row itself is gone. */
    scheduledDate: z.string().nullish(),
  }),

  quoteRecorded: z.object({
    ...booking,
    /** Formatted, e.g. "$4,500". */
    amount: z.string(),
    /** The booking was booked directly, so it kept its status. */
    priceOnly: z.boolean(),
  }),

  invoiceRecorded: z.object({
    ...booking,
    /** The tradie's own number, when the invoice carries one. */
    invoiceNumber: z.string().nullish(),
    /** Formatted ex GST, e.g. "$4,500.00". */
    amount: z.string(),
    /** "MANUAL" or "XERO". */
    source: z.string(),
  }),

  invoiceAllocated: z.object({
    ...booking,
    invoiceNumber: z.string().nullish(),
    amount: z.string(),
  }),

  invoiceVoided: z.object({
    ...booking,
    invoiceNumber: z.string().nullish(),
    amount: z.string(),
    reason: z.string().min(1),
  }),

  requestEmailSent: z.object({
    tradieId: z.string().min(1),
    projectId: z.string().min(1),
    to: z.string(),
    attempt: z.number().int().positive(),
    via: z.string().nullish(),
  }),

  requestEmailNotSent: z.object({
    tradieId: z.string().min(1),
    projectId: z.string().min(1),
    to: z.string(),
    /** Operator-facing: why, and what happens next. */
    reason: z.string(),
    via: z.string().nullish(),
  }),

  bookingEmailSent: z.object({
    ...booking,
    subject: z.string(),
  }),

  selectedForTrade: z.object({
    tradieId: z.string().min(1),
    projectId: z.string().min(1),
    trade: z.string(),
    /** Chosen from a quote, rather than booked directly. */
    fromQuote: z.boolean(),
  }),

  tradeCancellationRequested: z.object({
    tradieId: z.string().min(1),
    projectId: z.string().min(1),
    trade: z.string(),
    reason: z.string(),
  }),

  tradeCancellationResolved: z.object({
    tradieId: z.string().min(1),
    projectId: z.string().min(1),
    trade: z.string(),
    approved: z.boolean(),
    cancelledBookings: z.number().int().nonnegative(),
  }),

  removedFromDirectory: z.object({
    tradieId: z.string().min(1),
    cancelledBookings: z.number().int().nonnegative(),
  }),

  incidentReported: z.object({
    tradieId: z.string().min(1),
    incidentType: z.string(),
    severity: z.string(),
  }),

  incidentResolved: z.object({
    tradieId: z.string().min(1),
    resolution: z.string(),
  }),
};
