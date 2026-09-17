import type { InvoiceStatus } from "@prisma/client";

import { isPendingInvoiceStatus } from "@/lib/xero/invoice-status";

/** The minimum needed to judge how a claim should read. */
export interface DisplayableInvoice {
  status: InvoiceStatus;
  dueDate: Date | string;
}

/**
 * `today` is a parameter rather than a `Date.now()` inside these functions.
 *
 * Two reasons, and both matter: reading the clock mid-render is impure, which
 * the React Compiler rejects outright, and a shared reference date keeps a
 * table from disagreeing with itself when a claim falls due between two rows
 * being evaluated. Callers pass `new Date()`, matching `duenessOf` in the
 * milestone ledger.
 */
export function isInvoiceOverdue(
  invoice: DisplayableInvoice,
  today: Date,
): boolean {
  return (
    isPendingInvoiceStatus(invoice.status) &&
    new Date(invoice.dueDate).getTime() < today.getTime()
  );
}

/** Tones borrowed from `StatusPill`, so claims read like every other status. */
export type InvoiceTone = "success" | "danger" | "warning" | "neutral";

/**
 * How a claim should read: paid is done, an overdue claim is a debt worth
 * chasing, a withdrawn one is neutral history, and anything else is simply
 * outstanding.
 */
export function invoiceTone(
  invoice: DisplayableInvoice,
  today: Date,
): InvoiceTone {
  if (invoice.status === "PAID") {
    return "success";
  }
  if (invoice.status === "VOIDED" || invoice.status === "DELETED") {
    return "neutral";
  }

  return isInvoiceOverdue(invoice, today) ? "danger" : "warning";
}

/**
 * Claims still owed, and how many of those have run past their due date.
 *
 * Overdue is what changes the tone on the Payments tab badge: an outstanding
 * claim is routine, a missed one is not.
 */
export function countPendingInvoices(
  invoices: readonly DisplayableInvoice[],
  today: Date,
): { pending: number; overdue: number } {
  const pending = invoices.filter((invoice) =>
    isPendingInvoiceStatus(invoice.status),
  );

  return {
    pending: pending.length,
    overdue: pending.filter((invoice) => isInvoiceOverdue(invoice, today))
      .length,
  };
}
