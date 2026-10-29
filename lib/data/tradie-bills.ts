import "server-only";

import { revalidateTag } from "next/cache";
import type { Invoice } from "xero-node";

import { systemPrincipal } from "@/lib/domain/principal";
import {
  syncTradieBillFromExternal,
  type ExternalTradieBill,
  type TradieBillSyncResult,
} from "@/lib/domain/tradies/invoices";
import { findAdminUserIds } from "@/lib/domain/identity/users";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import type { XeroContext } from "@/lib/xero/client";
import { toInvoiceStatus } from "@/lib/xero/invoice-status";
import { parseXeroDate } from "@/lib/xero/xero-date";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import { rateCurrency } from "@/utils/formatters";

// The Xero half of a tradie's bill: read it, hand it to the domain, and tell
// the office about the ones the domain could not place.
//
// Reached from the invoice webhook for an invoice that is not one of our
// progress claims. Xero sends one event category for sales invoices and bills
// alike, so most of what arrives here is the bookkeeper's own work and is
// dropped at the type check.

const XERO_BILL = systemPrincipal("xero:bill-webhook");

/**
 * Mirror one Xero invoice if it is a tradie's bill.
 *
 * `created` says the webhook reported this bill as new. The office is told
 * about a bill it has to act on only then: Xero sends an update for every
 * edit, approval and payment, and a notification for each would teach the
 * office to ignore them.
 */
export async function syncTradieBillFromXero(
  context: XeroContext,
  xeroInvoiceId: string,
  options: { readonly created: boolean },
): Promise<TradieBillSyncResult | null> {
  const response = await context.xero.accountingApi.getInvoice(
    context.tenantId,
    xeroInvoiceId,
  );
  const invoice = response.body.invoices?.[0];
  // The SDK types `type` as a numeric enum; the API sends the string.
  if (!invoice || String(invoice.type).toUpperCase() !== "ACCPAY") return null;
  const status = toInvoiceStatus(invoice.status);
  if (!status) return null;

  // Every Xero read first, outside the transaction: a transaction held open
  // across an API call holds its connection for as long as Xero takes. The
  // mirrored bill and its line on the tradie's history then commit together.
  const bill = await billFromXero(context, xeroInvoiceId, invoice, status);
  const result = await prisma.$transaction((tx) =>
    syncTradieBillFromExternal(XERO_BILL, bill, tx),
  );

  if ("projectId" in result) {
    revalidateTag(`project-${result.projectId}`, CACHE_PROFILES.MEDIUM);
  }
  if (options.created) await notifyIfUnplaced(result, invoice);
  return result;
}

async function billFromXero(
  context: XeroContext,
  xeroInvoiceId: string,
  invoice: Invoice,
  status: NonNullable<ReturnType<typeof toInvoiceStatus>>,
): Promise<ExternalTradieBill> {
  // An invoice carries a summary of its contact, which may lack the ABN and
  // the email the tradie is matched on; the contact itself has both.
  let contact = invoice.contact;
  if (contact?.contactID && !contact.taxNumber && !contact.emailAddress) {
    try {
      const full = await context.xero.accountingApi.getContact(
        context.tenantId,
        contact.contactID,
      );
      contact = full.body.contacts?.[0] ?? contact;
    } catch (error) {
      console.error(
        `[xero] Could not read the contact on bill ${xeroInvoiceId}:`,
        error,
      );
    }
  }
  const emails = [
    contact?.emailAddress,
    ...(contact?.contactPersons ?? []).map((person) => person.emailAddress),
  ].filter((email): email is string => Boolean(email));

  return {
    amountPaid: invoice.amountPaid ?? 0,
    contact: {
      emails,
      name: contact?.name ?? null,
      taxNumber: contact?.taxNumber ?? null,
    },
    currencyCode: invoice.currencyCode ? String(invoice.currencyCode) : "AUD",
    dueDate: parseXeroDate(invoice.dueDate),
    invoiceNumber: invoice.invoiceNumber ?? null,
    issuedDate: parseXeroDate(invoice.date) ?? new Date(),
    reference: invoice.reference ?? null,
    status,
    subTotal: invoice.subTotal ?? 0,
    total: invoice.total ?? 0,
    totalTax: invoice.totalTax ?? 0,
    xeroInvoiceId,
    xeroUpdatedAt: parseXeroDate(invoice.updatedDateUTC),
  };
}

/** Never throws: the bill is mirrored, and the rest of the batch must run. */
async function notifyIfUnplaced(
  result: TradieBillSyncResult,
  invoice: Invoice,
): Promise<void> {
  const notification =
    result.kind === "unmatched"
      ? createNotification("tradieInvoiceUnmatched", {
          amount: rateCurrency.format(result.subTotalCents / 100),
          invoiceNumber: invoice.invoiceNumber ?? null,
          tradieId: result.tradieId,
          tradieName: result.tradieName,
        })
      : result.kind === "created" && !result.scheduleId
        ? createNotification("tradieInvoiceNeedsAllocation", {
            amount: rateCurrency.format(result.subTotalCents / 100),
            invoiceNumber: invoice.invoiceNumber ?? null,
            projectId: result.projectId,
            projectName: result.projectName,
            tradieName: result.tradieName,
          })
        : null;
  if (!notification) return;
  try {
    const admins = await findAdminUserIds(prisma);
    // An empty list means everyone to Novu; with no admins, tell nobody.
    if (admins.length === 0) return;
    const sent = await triggerNotification(admins, notification);
    if (!sent.success) {
      console.error("[xero] Could not notify admins about a bill:", sent);
    }
  } catch (error) {
    console.error("[xero] Could not notify admins about a bill:", error);
  }
}
