import { InvoiceStatus } from "@prisma/client";
import { Invoice } from "xero-node";

/**
 * Xero's invoice status codes, mapped one to one onto ours.
 *
 * The SDK generates `Invoice.StatusEnum` as a NUMERIC TypeScript enum, but the
 * API returns the status as a string ("AUTHORISED"). Keying this map on the
 * string is therefore both correct for real responses and stable against the
 * enum's numbering, which is an implementation detail of the generator.
 */
const XERO_STATUS: Record<string, InvoiceStatus> = {
  DRAFT: InvoiceStatus.DRAFT,
  SUBMITTED: InvoiceStatus.SUBMITTED,
  AUTHORISED: InvoiceStatus.AUTHORISED,
  PAID: InvoiceStatus.PAID,
  VOIDED: InvoiceStatus.VOIDED,
  DELETED: InvoiceStatus.DELETED,
};

/**
 * Translate a status off a Xero invoice. Returns null for anything
 * unrecognised, so a status Xero adds later is ignored rather than crashing the
 * webhook or being coerced into the wrong state.
 */
export function toInvoiceStatus(
  status: Invoice.StatusEnum | string | undefined | null,
): InvoiceStatus | null {
  if (status === undefined || status === null) {
    return null;
  }

  return XERO_STATUS[String(status).toUpperCase()] ?? null;
}

/**
 * Monotonic rank for forward-only status changes.
 *
 * An invoice moves DRAFT → SUBMITTED → AUTHORISED → (PAID | VOIDED | DELETED)
 * and never back. Webhook deliveries can arrive out of order or be replayed, so
 * a status is only applied when it ranks strictly higher than the one on
 * record — that is what stops a late AUTHORISED event un-paying a paid claim.
 *
 * The three terminal states share a rank: they are mutually exclusive ends, not
 * steps past one another.
 */
export function invoiceStatusRank(status: InvoiceStatus): number {
  switch (status) {
    case InvoiceStatus.DRAFT:
      return 1;
    case InvoiceStatus.SUBMITTED:
      return 2;
    case InvoiceStatus.AUTHORISED:
      return 3;
    case InvoiceStatus.PAID:
    case InvoiceStatus.VOIDED:
    case InvoiceStatus.DELETED:
      return 4;
    default:
      return 0;
  }
}

/** Statuses that no longer owe anything — excluded from the "pending" count. */
export const SETTLED_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.VOIDED,
  InvoiceStatus.DELETED,
];

/** True when the claim is still owed, i.e. it counts toward the Payments badge. */
export function isPendingInvoiceStatus(status: InvoiceStatus): boolean {
  return !SETTLED_INVOICE_STATUSES.includes(status);
}
