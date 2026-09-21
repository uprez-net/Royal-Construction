import { InvoiceStatus, OutboxEventKind, Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainTransitionError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";

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
    existing.xeroUpdatedAt
    && fields.xeroUpdatedAt
    && fields.xeroUpdatedAt <= existing.xeroUpdatedAt
  ) {
    return { kind: "stale" };
  }
  if (invoiceStatusRank(fields.status) < invoiceStatusRank(existing.status)) {
    return { kind: "stale" };
  }

  await db.invoice.update({ where: { id: existing.id }, data: fields });

  if (!existing.pdfUrl && incoming.archivePdf) {
    await archiveInvoicePdf(
      existing.id,
      xeroInvoiceId,
      db,
      incoming.archivePdf,
    );
  }

  return { invoiceId: existing.id, kind: "updated" };
}

/**
 * Park the rendered invoice in our own storage, behind a repeatable intent.
 *
 * Marked repeatable, unlike the issuance: the archive writes to a path derived
 * from the Xero invoice id and overwrites in place, so running it twice lands
 * the same object. Refusing to retry would be the wrong trade here — Xero
 * still holds the document and the claim does not depend on our copy, so a
 * transient storage failure must not become a permanent "needs reconciliation"
 * that nobody clears.
 *
 * Failure stays non-fatal for the same reason it always was: the invoice sync
 * that just committed is the thing that matters, and losing our copy of the
 * PDF must not lose it.
 */
export async function archiveInvoicePdf(
  invoiceId: string,
  xeroInvoiceId: string,
  db: DomainDb,
  archive: () => Promise<string | null>,
): Promise<void> {
  try {
    const { result } = await runOutboxEffectWithOutcome(
      db,
      {
        key: `invoice-pdf:${xeroInvoiceId}`,
        kind: OutboxEventKind.INVOICE_PDF_ARCHIVE,
        payload: { invoiceId, xeroInvoiceId },
      },
      async () => {
        const pdfUrl = await archive();
        if (pdfUrl) {
          await db.invoice.update({
            data: { pdfUrl },
            where: { id: invoiceId },
          });
        }
        return { pdfUrl };
      },
      { repeatable: true },
    );
    // A replayed intent carries the url the first attempt stored. The row may
    // still be missing it if that attempt died between the two writes.
    if (result.pdfUrl) {
      await db.invoice.updateMany({
        data: { pdfUrl: result.pdfUrl },
        where: { id: invoiceId, pdfUrl: null },
      });
    }
  } catch (error) {
    console.error(
      `[invoice] Could not archive the PDF for ${xeroInvoiceId}:`,
      error,
    );
  }
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
