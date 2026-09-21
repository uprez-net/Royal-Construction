import { InvoiceStatus, Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainTransitionError } from "../errors";

export type InvoiceSyncFields = {
  readonly invoiceNumber: string | null;
  readonly reference: string | null;
  readonly status: InvoiceStatus;
  readonly currencyCode: string;
  readonly subTotal: Prisma.Decimal;
  readonly totalTax: Prisma.Decimal;
  readonly total: Prisma.Decimal;
  readonly amountDue: Prisma.Decimal;
  readonly amountPaid: Prisma.Decimal;
  readonly amountCredited: Prisma.Decimal;
  readonly issuedDate: Date;
  readonly dueDate: Date;
  readonly fullyPaidOnDate: Date | null;
  readonly xeroUpdatedAt: Date | null;
};

export type InvoiceSyncSource = (existing: {
  readonly invoiceId: string;
  readonly projectId: string;
}) => Promise<{
  fields: InvoiceSyncFields;
  archivePdf?: () => Promise<string | null>;
} | null>;

export type InvoiceSyncResult =
  | { readonly kind: "unknown" }
  | { readonly kind: "missing-external-invoice" }
  | { readonly kind: "stale" }
  | { readonly kind: "updated"; readonly invoiceId: string };

/**
 * Apply one external invoice webhook monotonically.
 *
 * The Xero adapter resolves SDK objects and PDF bytes; this command owns the
 * local identity lookup, replay/staleness rules, mirrored write, and the
 * optional PDF URL write. An unknown invoice is deliberately ignored because
 * the Xero organisation may contain bookkeeper-created invoices that are not
 * Royal Construction claims.
 */
export async function syncInvoiceFromExternal(
  xeroInvoiceId: string,
  db: DomainDb,
  source: InvoiceSyncSource,
): Promise<InvoiceSyncResult> {
  const existing = await db.invoice.findUnique({
    select: {
      id: true,
      pdfUrl: true,
      projectId: true,
      status: true,
      xeroUpdatedAt: true,
    },
    where: { xeroInvoiceId },
  });
  if (!existing) return { kind: "unknown" };

  const incoming = await source({
    invoiceId: existing.id,
    projectId: existing.projectId,
  });
  if (!incoming) return { kind: "missing-external-invoice" };
  const { fields } = incoming;

  if (
    existing.xeroUpdatedAt &&
    fields.xeroUpdatedAt &&
    fields.xeroUpdatedAt <= existing.xeroUpdatedAt
  ) {
    return { kind: "stale" };
  }
  if (invoiceStatusRank(fields.status) < invoiceStatusRank(existing.status)) {
    return { kind: "stale" };
  }

  await db.invoice.update({ where: { id: existing.id }, data: fields });

  if (!existing.pdfUrl && incoming.archivePdf) {
    const pdfUrl = await incoming.archivePdf();
    if (pdfUrl) {
      await db.invoice.update({
        data: { pdfUrl },
        where: { id: existing.id },
      });
    }
  }

  return { invoiceId: existing.id, kind: "updated" };
}

function invoiceStatusRank(status: InvoiceStatus): number {
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
      throw new DomainTransitionError("The invoice status is not supported.");
  }
}
