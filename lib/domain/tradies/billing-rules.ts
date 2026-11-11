import {
  InvoiceStatus,
  TradieQuoteGst,
  TradieScheduleStatus,
} from "@prisma/client";

import { parseQuotedAmount } from "../../../utils/calculations";
import { calculateOfferLinePricing } from "@/lib/offer/pricing";
import { tradieScheduleSpend } from "./lifecycle";
import { APPROVED_STATUSES } from "./selection-rules";

// What a tradie's invoices mean for the booking they bill. Pure, so the
// Financials tab and the commands that record an invoice read one answer.
//
// A booking's work status (TradieScheduleStatus) is left alone on purpose. A
// tradie often invoices while the job is still under way — a deposit, then
// progress claims — so "invoiced" is not a step after COMPLETED, and folding
// it into that state machine would have every alert, filter and settlement
// rule learn a status that says nothing about the work. The billing state sits
// beside the work status instead, derived from the invoices every time it is
// read, so it can never disagree with them.

/** Every amount here is whole cents, so totals add up exactly. */
export type Cents = number;

export function toCents(amount: number | string | { toString(): string }) {
  const value = typeof amount === "number" ? amount : Number(amount.toString());
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/**
 * Bookings whose price is a commitment: through, or past, the admin's
 * approval. A quote still waiting to be chosen is not money the job will
 * spend, and a declined or cancelled booking is not either.
 */
export const COMMITTED_SCHEDULE_STATUSES: readonly TradieScheduleStatus[] = [
  ...APPROVED_STATUSES,
  TradieScheduleStatus.COMPLETED,
];

export function isCommittedBooking(status: TradieScheduleStatus): boolean {
  return COMMITTED_SCHEDULE_STATUSES.includes(status);
}

/**
 * Whether an invoice counts towards what was charged. A voided or deleted bill
 * was withdrawn; a draft one in Xero is still the tradie asking for the money,
 * so it counts.
 */
export function isCountedInvoice(status: InvoiceStatus): boolean {
  return status !== InvoiceStatus.VOIDED && status !== InvoiceStatus.DELETED;
}

/** Where a booking's price came from. */
export type PriceBasis =
  /** A quote, or a price the office entered. */
  | "QUOTE"
  /** Worked out from the tradie's rate and the booking's days. */
  | "RATE"
  /** Nothing to price it from yet. */
  | "NONE";

export type BookingPrice = {
  /** Ex GST, so it compares with the tender and with an invoice's subtotal. */
  readonly exGstCents: Cents;
  readonly gstCents: Cents;
  readonly basis: PriceBasis;
  /**
   * False when the quote did not say whether its amount includes GST. It is
   * then read as ex GST, which is what a tradie's quote almost always is, and
   * the screen says it was assumed.
   */
  readonly gstStated: boolean;
};

/**
 * What a booking is agreed at, ex GST.
 *
 * The amount is `tradieScheduleSpend`'s — the rule that already says what a
 * booking costs its milestone — so the Financials tab cannot price a booking
 * differently from the milestone it sits on. Only the GST basis is added here:
 * a quote recorded as GST-inclusive is brought back to ex GST, because the
 * tender it is compared with is ex GST.
 */
export function bookingPrice(schedule: {
  readonly status: TradieScheduleStatus;
  readonly requiresQuote: boolean;
  readonly quotedPrice: string | null;
  readonly durationDays: number;
  readonly tradie: {
    readonly lastQuotedPrice?: string | null;
    readonly lastQuotedPriceUnit: "HOURLY" | "FIXED";
  };
  readonly quoteGst: TradieQuoteGst | null;
}): BookingPrice {
  const spend = tradieScheduleSpend(schedule);
  // A stored price that does not read as one amount is a missing quote, not a
  // $0 one: it must show as "Quote missing", not as a price of nothing.
  const basis: PriceBasis =
    parseQuotedAmount(schedule.quotedPrice) !== null
      ? "QUOTE"
      : spend > 0
        ? "RATE"
        : "NONE";
  const cents = toCents(spend);
  const pricing = calculateOfferLinePricing({
    gstIncluded: schedule.quoteGst === TradieQuoteGst.INCLUSIVE,
    gstRate:
      schedule.quoteGst === TradieQuoteGst.NOT_REGISTERED ? 0 : undefined,
    quantity: 1,
    unitPrice: cents / 100,
  });
  return {
    basis,
    exGstCents: toCents(pricing.netLine),
    gstCents: toCents(pricing.gstAmount),
    gstStated: basis !== "QUOTE" || schedule.quoteGst !== null,
  };
}

/** Where a booking is up to with its invoices. */
export type BookingBillingState =
  | "NOT_INVOICED"
  /** Invoiced for less than it is agreed at: more invoices may follow. */
  | "PART_INVOICED"
  /** Invoiced for exactly what it is agreed at. */
  | "INVOICED"
  /** Invoiced for more than it is agreed at. */
  | "OVER_INVOICED"
  /** Invoiced, with no price to hold the invoices against. */
  | "INVOICED_UNPRICED";

export function bookingBillingState(input: {
  readonly agreedCents: Cents;
  readonly invoicedCents: Cents;
}): BookingBillingState {
  if (input.invoicedCents <= 0) return "NOT_INVOICED";
  if (input.agreedCents <= 0) return "INVOICED_UNPRICED";
  if (input.invoicedCents < input.agreedCents) return "PART_INVOICED";
  if (input.invoicedCents === input.agreedCents) return "INVOICED";
  return "OVER_INVOICED";
}

/**
 * Where one booking is up to with its invoices, from the booking as stored.
 * Null for a booking that is neither committed nor billed — a quote never
 * chosen, or one declined before anyone invoiced — which has no billing to
 * speak of. The Financials tab leaves those out for the same reason.
 */
export function bookingBilling(schedule: {
  readonly status: TradieScheduleStatus;
  readonly requiresQuote: boolean;
  readonly quotedPrice: string | null;
  readonly durationDays: number;
  readonly tradie: {
    readonly lastQuotedPrice?: { toString(): string } | string | null;
    readonly lastQuotedPriceUnit: "HOURLY" | "FIXED";
  };
  readonly quote?: { readonly gstTreatment: TradieQuoteGst | null } | null;
  readonly invoices: readonly {
    readonly status: InvoiceStatus;
    readonly subTotal: number | string | { toString(): string };
  }[];
}): BookingBillingState | null {
  const counted = schedule.invoices.filter((invoice) =>
    isCountedInvoice(invoice.status),
  );
  const committed = isCommittedBooking(schedule.status);
  if (!committed && counted.length === 0) return null;
  const price = bookingPrice({
    ...schedule,
    quoteGst: schedule.quote?.gstTreatment ?? null,
    tradie: {
      lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString() ?? null,
      lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
    },
  });
  return bookingBillingState({
    agreedCents: committed ? price.exGstCents : 0,
    invoicedCents: counted.reduce(
      (total, invoice) => total + toCents(invoice.subTotal),
      0,
    ),
  });
}

export const BILLING_STATE_LABELS: Record<BookingBillingState, string> = {
  INVOICED: "Fully invoiced",
  INVOICED_UNPRICED: "Invoiced, no quote",
  NOT_INVOICED: "Not invoiced",
  OVER_INVOICED: "Invoiced exceeds quoted",
  PART_INVOICED: "Part invoiced",
};
