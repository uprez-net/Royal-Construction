import type { DomainDb } from "../db";
import { authorizeProject } from "../access/projects";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import {
  bookingBillingState,
  bookingPrice,
  isCommittedBooking,
  isCountedInvoice,
  toCents,
} from "./billing-rules";
import {
  sendTradieScheduleReminder,
  type TradieReminderEmailPort,
} from "./reminders";
import { bookingTrade } from "./request-rules";
import { generateTradieInvoiceRecheckEmail } from "../../../utils/generate-email";

// "Request recheck" on the Financials tab: the booking has been invoiced for
// more than it was approved at, and the office asks the tradie to look again.
//
// The email is built here and nowhere else, so the dialog's preview and the
// email that leaves are the same render. It goes out through the booking
// reminder send, which already owns everything a tradie email needs: the
// tradie's current address, the RCTBK reference the reply is matched on, the
// outbox guard against a double send, and the line on the tradie's history.
// The booking's status and quote are not touched — a recheck is a question.

export type TradieInvoiceRecheck = {
  readonly scheduleId: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
};

/**
 * The recheck email for one booking, or a refusal saying why there is
 * nothing to recheck. Admin only, like the figures it quotes.
 */
export async function prepareTradieInvoiceRecheck(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly scheduleId: string },
  db: DomainDb,
): Promise<TradieInvoiceRecheck> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);

  const schedule = await db.tradieSchedule.findUnique({
    select: {
      durationDays: true,
      id: true,
      invoices: {
        orderBy: { issuedDate: "asc" },
        select: {
          invoiceNumber: true,
          issuedDate: true,
          status: true,
          subTotal: true,
        },
      },
      milestone: { select: { name: true } },
      project: {
        select: {
          name: true,
          siteManager: { select: { email: true, name: true, phone: true } },
        },
      },
      projectId: true,
      quote: { select: { gstTreatment: true } },
      quotedPrice: true,
      refToken: true,
      requiresQuote: true,
      status: true,
      trade: true,
      tradie: {
        select: {
          email: true,
          lastQuotedPrice: true,
          lastQuotedPriceUnit: true,
          name: true,
          trade: true,
        },
      },
    },
    where: { id: input.scheduleId },
  });
  if (!schedule || schedule.projectId !== input.projectId) {
    throw new DomainNotFoundError("That booking is not on this project.");
  }

  const price = bookingPrice({
    ...schedule,
    quoteGst: schedule.quote?.gstTreatment ?? null,
    tradie: {
      lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString() ?? null,
      lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
    },
  });
  const invoices = schedule.invoices
    .filter((invoice) => isCountedInvoice(invoice.status))
    .map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      issuedDate: invoice.issuedDate.toISOString(),
      subTotalCents: toCents(invoice.subTotal),
    }));
  const agreedCents = isCommittedBooking(schedule.status)
    ? price.exGstCents
    : 0;
  const billing = bookingBillingState({
    agreedCents,
    invoicedCents: invoices.reduce(
      (total, invoice) => total + invoice.subTotalCents,
      0,
    ),
  });
  if (billing !== "OVER_INVOICED") {
    throw new DomainTransitionError(
      agreedCents === 0
        ? "This booking has no approved price to check its invoices against. Record its quote first."
        : "This booking's invoices are within its approved quote, so there is nothing to recheck.",
      billing,
      "OVER_INVOICED",
    );
  }
  if (price.basis === "RATE") {
    // An estimate from the tradie's rate is ours, not a price they agreed to;
    // telling them they billed over it would quote a number they never gave.
    throw new DomainValidationError(
      "This booking's price is only an estimate from the tradie's rate. Record the agreed price before asking them to recheck.",
    );
  }

  const to = schedule.tradie.email.trim();
  const { subject, html } = generateTradieInvoiceRecheckEmail({
    activityName: schedule.milestone?.name ?? "General task",
    invoices,
    projectName: schedule.project.name,
    quoteGstStated: price.gstStated,
    quotedCents: agreedCents,
    reference: schedule.refToken,
    siteManager: {
      email: schedule.project.siteManager?.email ?? "",
      name: schedule.project.siteManager?.name ?? "Unassigned",
      phone: schedule.project.siteManager?.phone ?? "",
    },
    trade: bookingTrade(schedule),
    tradieName: schedule.tradie.name,
  });
  return { html, scheduleId: schedule.id, subject, to };
}

/**
 * Email the tradie the recheck.
 *
 * `attemptKey` belongs to the attempt, not the click: the dialog keeps it
 * until a send succeeds, so a double click or a retry after a timeout lands on
 * the same email, and a deliberate later recheck goes out as a new one.
 */
export async function requestTradieInvoiceRecheck(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly scheduleId: string;
    readonly attemptKey: string;
  },
  db: DomainDb,
  send: TradieReminderEmailPort,
): Promise<{ readonly to: string; readonly alreadySent: boolean }> {
  const attemptKey = input.attemptKey.trim();
  if (!attemptKey) {
    throw new DomainValidationError(
      "Missing request key; close the dialog and open it again.",
    );
  }
  const recheck = await prepareTradieInvoiceRecheck(principal, input, db);
  return sendTradieScheduleReminder(
    principal,
    {
      body: recheck.html,
      idempotencyKey: `invoice-recheck:${recheck.scheduleId}:${attemptKey}`,
      scheduleId: recheck.scheduleId,
      subject: recheck.subject,
    },
    db,
    send,
  );
}
