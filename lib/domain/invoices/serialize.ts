import type { Prisma, Invoice as InvoiceRow } from "@prisma/client";

import type { ProjectListInvoice, SafeInvoice } from "@/types/project";

// Progress-claim serialization for the RSC boundary.
//
// Moved out of `lib/data/invoice.ts` in phase 4. Nothing about stripping a
// Decimal needs Next, but that module opens with `next/cache`, `@vercel/blob`
// and `xero-node`, so the project queries could not reach these two pure
// functions without dragging the Xero client into the domain layer. They are
// the same functions; `lib/data/invoice.ts` re-exports them so its own callers
// are unaffected.

/**
 * Strip Prisma `Decimal`s off an invoice for the RSC boundary.
 *
 * Decimals are class instances and are not serializable, so every money field
 * crosses as a string and the client does its own `Number(...)` — the same
 * contract the project reads apply to budgets and milestone spend.
 */
export function serializeInvoice(invoice: InvoiceRow): SafeInvoice {
  return {
    ...invoice,
    subTotal: invoice.subTotal.toString(),
    totalTax: invoice.totalTax.toString(),
    total: invoice.total.toString(),
    amountDue: invoice.amountDue.toString(),
    amountPaid: invoice.amountPaid.toString(),
    amountCredited: invoice.amountCredited.toString(),
  };
}

/** The narrower claim row the project LIST payload carries. */
export function serializeListInvoice(invoice: {
  id: string;
  invoiceNumber: string | null;
  projectStage: ProjectListInvoice["projectStage"];
  status: ProjectListInvoice["status"];
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  amountDue: Prisma.Decimal;
  issuedDate: Date;
  dueDate: Date;
}): ProjectListInvoice {
  return {
    ...invoice,
    total: invoice.total.toString(),
    amountPaid: invoice.amountPaid.toString(),
    amountDue: invoice.amountDue.toString(),
  };
}
