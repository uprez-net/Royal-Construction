import { InvoiceStatus } from "@prisma/client";

import type { ProjectInvoiceTotals } from "@/types/project";

/** The fields a roll-up needs. Structural, so Prisma rows and test literals both fit. */
export interface SummarizableInvoice {
  status: InvoiceStatus;
  total: unknown;
  amountPaid: unknown;
  amountDue: unknown;
}

/**
 * Roll a project's progress claims into the four figures the UI shows.
 *
 * Money comes back as strings, because these totals ride on payloads that cross
 * the RSC boundary and Prisma `Decimal`s do not serialize. The inputs are typed
 * `unknown` for the same reason — a caller may hand over a `Decimal`, a string
 * from an already-serialized row, or a plain number, and all three coerce the
 * same way.
 *
 * VOIDED and DELETED claims are excluded from every total: a voided claim was
 * withdrawn, so counting its total as "invoiced" would overstate what the owner
 * was ever asked for. A PAID claim still counts toward invoiced and paid, and
 * contributes nothing to outstanding.
 */
export function summarizeInvoices(
  invoices: readonly SummarizableInvoice[],
): ProjectInvoiceTotals {
  let invoiced = 0;
  let paid = 0;
  let outstanding = 0;
  let pendingCount = 0;

  for (const invoice of invoices) {
    if (
      invoice.status === InvoiceStatus.VOIDED ||
      invoice.status === InvoiceStatus.DELETED
    ) {
      continue;
    }

    invoiced += money(invoice.total);
    paid += money(invoice.amountPaid);
    outstanding += money(invoice.amountDue);

    if (invoice.status !== InvoiceStatus.PAID) {
      pendingCount += 1;
    }
  }

  return {
    invoiced: invoiced.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: outstanding.toFixed(2),
    pendingCount,
  };
}

/** A money value as a number, treating anything unusable as zero. */
function money(value: unknown): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
