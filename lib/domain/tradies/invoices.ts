import { InvoiceStatus, Prisma, TradieInvoiceSource } from "@prisma/client";

import type { DomainDb } from "../db";
import { authorizeProject } from "../access/projects";
import { recordTradieActivity } from "../audit/tradie-activity-log";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { invoiceStatusRank } from "../invoices/sync";
import {
  attributionUserId,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import {
  bookingBillingState,
  bookingPrice,
  isCommittedBooking,
  isCountedInvoice,
  toCents,
  type BookingBillingState,
} from "./billing-rules";
import { extractTradieRefToken, tradieRefKind } from "./reply-reference";
import { rateCurrency } from "../../../utils/formatters";

// The bills tradies raise on us, and how each reaches its booking.
//
// Two ways in. The office types one in from an invoice that arrived by email
// or on paper (`recordTradieInvoice`), always against a booking it picks. Or
// the bookkeeper enters it in Xero as a bill and the invoice webhook mirrors
// it (`syncTradieBillFromExternal`), matched to its booking by the RCTBK
// reference we put on every booking email, and otherwise by who the tradie is
// and what they are booked on. A bill that can be pinned to the project but
// not to one booking is kept, unallocated, for the office to place: dropping
// it would leave a real cost off the job with nothing on screen to say so.

const amount = (cents: number) => rateCurrency.format(cents / 100);

/** The most GST a subtotal can carry, with a dollar of rounding headroom. */
function gstCeilingCents(subTotalCents: number): number {
  return Math.round(subTotalCents / 10) + 100;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

function invoiceNumberKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A booking's billing state, read back after an invoice moved. */
async function billingOf(
  scheduleId: string,
  db: DomainDb,
): Promise<BookingBillingState> {
  const schedule = await db.tradieSchedule.findUniqueOrThrow({
    select: {
      durationDays: true,
      invoices: { select: { status: true, subTotal: true } },
      quote: { select: { gstTreatment: true } },
      quotedPrice: true,
      requiresQuote: true,
      status: true,
      tradie: { select: { lastQuotedPrice: true, lastQuotedPriceUnit: true } },
    },
    where: { id: scheduleId },
  });
  const price = bookingPrice({
    ...schedule,
    quoteGst: schedule.quote?.gstTreatment ?? null,
    tradie: {
      lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString() ?? null,
      lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
    },
  });
  return bookingBillingState({
    agreedCents: isCommittedBooking(schedule.status) ? price.exGstCents : 0,
    invoicedCents: schedule.invoices
      .filter((invoice) => isCountedInvoice(invoice.status))
      .reduce((total, invoice) => total + toCents(invoice.subTotal), 0),
  });
}

/** A booking on this project, or a refusal that says which. */
async function bookingOnProject(
  input: { readonly projectId: string; readonly scheduleId: string },
  db: DomainDb,
) {
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      id: true,
      milestoneId: true,
      projectId: true,
      tradie: { select: { id: true, name: true } },
    },
    where: { id: input.scheduleId },
  });
  if (!schedule || schedule.projectId !== input.projectId) {
    throw new DomainNotFoundError("That booking is not on this project.");
  }
  return schedule;
}

export type RecordTradieInvoiceInput = {
  readonly projectId: string;
  readonly scheduleId: string;
  readonly invoiceNumber: string;
  readonly issuedDate: Date;
  readonly dueDate?: Date | null;
  /** Dollars, ex GST. */
  readonly subTotal: number;
  /** Dollars. Zero for a tradie not registered for GST. */
  readonly totalTax: number;
  readonly notes?: string | null;
};

export type RecordedTradieInvoice = {
  readonly invoiceId: string;
  readonly projectId: string;
  readonly scheduleId: string;
  /** Where the booking is up to now that this invoice is on it. */
  readonly billing: BookingBillingState;
};

/**
 * Record an invoice a tradie sent the office, against the booking it bills.
 *
 * The invoice number is required: every real invoice has one, and it is what
 * stops the same invoice being counted twice — a double-clicked Record, or one
 * the bookkeeper later enters in Xero too, which the sync then adopts instead
 * of adding (`syncTradieBillFromExternal`). The database holds the same rule,
 * so two requests that both pass the check below still land one row.
 *
 * Any booking on the project may be billed, cancelled ones included: a
 * cancellation fee is a cost too.
 */
export async function recordTradieInvoice(
  principal: DomainPrincipal,
  input: RecordTradieInvoiceInput,
  db: DomainDb,
): Promise<RecordedTradieInvoice> {
  requireAdminPrincipal(principal);
  const enteredById = attributionUserId(principal);
  if (!enteredById) {
    throw new DomainAuthorizationError(
      "Recording an invoice needs a signed-in user.",
    );
  }
  await authorizeProject(principal, input.projectId, db);

  const invoiceNumber = invoiceNumberKey(input.invoiceNumber);
  if (!invoiceNumber) {
    throw new DomainValidationError(
      "Enter the invoice number printed on the tradie's invoice.",
      "invoiceNumber",
    );
  }
  const subTotalCents = toCents(input.subTotal);
  const totalTaxCents = toCents(input.totalTax);
  if (!(subTotalCents > 0)) {
    throw new DomainValidationError(
      "The amount ex GST must be more than $0.",
      "subTotal",
    );
  }
  if (totalTaxCents < 0) {
    throw new DomainValidationError("GST cannot be negative.", "totalTax");
  }
  if (totalTaxCents > gstCeilingCents(subTotalCents)) {
    throw new DomainValidationError(
      "GST is more than 10% of the amount. Check the amount is ex GST and the GST is just the tax.",
      "totalTax",
    );
  }
  if (Number.isNaN(input.issuedDate.getTime())) {
    throw new DomainValidationError(
      "The invoice date is not a date.",
      "issuedDate",
    );
  }
  if (input.dueDate && input.dueDate < input.issuedDate) {
    throw new DomainValidationError(
      "An invoice cannot fall due before it was issued.",
      "dueDate",
    );
  }

  const schedule = await bookingOnProject(input, db);
  const duplicate = await db.tradieInvoice.findFirst({
    select: { id: true },
    where: {
      invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
      status: { notIn: [InvoiceStatus.VOIDED, InvoiceStatus.DELETED] },
      tradieId: schedule.tradie.id,
    },
  });
  const alreadyRecorded = new DomainValidationError(
    `Invoice ${invoiceNumber} from ${schedule.tradie.name} is already recorded.`,
    "invoiceNumber",
  );
  if (duplicate) throw alreadyRecorded;

  let created: { id: string };
  try {
    created = await db.tradieInvoice.create({
      data: {
        dueDate: input.dueDate ?? null,
        enteredById,
        invoiceNumber,
        issuedDate: input.issuedDate,
        notes: input.notes?.trim() || null,
        projectId: input.projectId,
        scheduleId: schedule.id,
        source: TradieInvoiceSource.MANUAL,
        status: InvoiceStatus.AUTHORISED,
        subTotal: new Prisma.Decimal(subTotalCents).div(100),
        total: new Prisma.Decimal(subTotalCents + totalTaxCents).div(100),
        totalTax: new Prisma.Decimal(totalTaxCents).div(100),
        tradieId: schedule.tradie.id,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyRecorded;
    throw error;
  }

  await recordTradieActivity(
    {
      data: {
        amount: amount(subTotalCents),
        invoiceNumber,
        milestoneId: schedule.milestoneId,
        projectId: input.projectId,
        scheduleId: schedule.id,
        source: TradieInvoiceSource.MANUAL,
        tradieId: schedule.tradie.id,
      },
      principal,
      type: "invoiceRecorded",
    },
    db,
  );

  return {
    billing: await billingOf(schedule.id, db),
    invoiceId: created.id,
    projectId: input.projectId,
    scheduleId: schedule.id,
  };
}

/**
 * Put an invoice against the booking it bills.
 *
 * For a bill from Xero that could not be pinned to one booking, and for
 * correcting one placed on the wrong booking. The booking must be the same
 * tradie's, on the same project: an invoice is the tradie's claim on their own
 * work, and moving it onto someone else's booking would be a different claim.
 */
export async function allocateTradieInvoice(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly invoiceId: string;
    readonly scheduleId: string;
  },
  db: DomainDb,
): Promise<RecordedTradieInvoice> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);

  const invoice = await db.tradieInvoice.findUnique({
    select: {
      id: true,
      invoiceNumber: true,
      projectId: true,
      scheduleId: true,
      status: true,
      subTotal: true,
      tradieId: true,
    },
    where: { id: input.invoiceId },
  });
  if (!invoice || invoice.projectId !== input.projectId) {
    throw new DomainNotFoundError("Invoice not found.");
  }
  if (!isCountedInvoice(invoice.status)) {
    throw new DomainTransitionError(
      "This invoice was voided, so it is not put against a booking.",
      invoice.status,
      invoice.status,
    );
  }
  const schedule = await bookingOnProject(input, db);
  if (schedule.tradie.id !== invoice.tradieId) {
    throw new DomainValidationError(
      "That booking is another tradie's. An invoice can only go against the invoicing tradie's own booking.",
      "scheduleId",
    );
  }
  if (invoice.scheduleId === schedule.id) {
    return {
      billing: await billingOf(schedule.id, db),
      invoiceId: invoice.id,
      projectId: input.projectId,
      scheduleId: schedule.id,
    };
  }

  await db.tradieInvoice.update({
    data: {
      enteredById: attributionUserId(principal),
      scheduleId: schedule.id,
    },
    where: { id: invoice.id },
  });
  await recordTradieActivity(
    {
      data: {
        amount: amount(toCents(invoice.subTotal)),
        invoiceNumber: invoice.invoiceNumber,
        milestoneId: schedule.milestoneId,
        projectId: input.projectId,
        scheduleId: schedule.id,
        tradieId: invoice.tradieId,
      },
      principal,
      type: "invoiceAllocated",
    },
    db,
  );

  return {
    billing: await billingOf(schedule.id, db),
    invoiceId: invoice.id,
    projectId: input.projectId,
    scheduleId: schedule.id,
  };
}

/**
 * Void an invoice the office recorded by hand — entered twice, against the
 * wrong tradie, or withdrawn by them.
 *
 * Only a manual one. A bill mirrored from Xero is voided in Xero, where the
 * bookkeeper keeps the ledger; voiding it here would be undone by the next
 * webhook delivery and leave the two disagreeing until then.
 */
export async function voidTradieInvoice(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly invoiceId: string;
    readonly reason: string;
  },
  db: DomainDb,
): Promise<{ readonly invoiceId: string; readonly projectId: string }> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);
  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainValidationError(
      "Say why the invoice is being voided.",
      "reason",
    );
  }

  const invoice = await db.tradieInvoice.findUnique({
    select: {
      id: true,
      invoiceNumber: true,
      projectId: true,
      schedule: { select: { id: true, milestoneId: true } },
      source: true,
      status: true,
      subTotal: true,
      tradieId: true,
    },
    where: { id: input.invoiceId },
  });
  if (!invoice || invoice.projectId !== input.projectId) {
    throw new DomainNotFoundError("Invoice not found.");
  }
  if (invoice.source !== TradieInvoiceSource.MANUAL) {
    throw new DomainTransitionError(
      "This invoice comes from Xero. Void the bill in Xero and it will update here.",
      invoice.status,
      InvoiceStatus.VOIDED,
    );
  }
  const voided = await db.tradieInvoice.updateMany({
    data: { status: InvoiceStatus.VOIDED },
    where: {
      id: invoice.id,
      status: { notIn: [InvoiceStatus.VOIDED, InvoiceStatus.DELETED] },
    },
  });
  // Already voided — a second click, or another tab. Nothing changed, so
  // nothing goes on the tradie's history twice.
  if (voided.count === 0) {
    return { invoiceId: invoice.id, projectId: input.projectId };
  }

  if (invoice.schedule) {
    await recordTradieActivity(
      {
        data: {
          amount: amount(toCents(invoice.subTotal)),
          invoiceNumber: invoice.invoiceNumber,
          milestoneId: invoice.schedule.milestoneId,
          projectId: input.projectId,
          reason,
          scheduleId: invoice.schedule.id,
          tradieId: invoice.tradieId,
        },
        principal,
        type: "invoiceVoided",
      },
      db,
    );
  }
  return { invoiceId: invoice.id, projectId: input.projectId };
}

/** A bill as the Xero adapter read it. Amounts in dollars. */
export type ExternalTradieBill = {
  readonly xeroInvoiceId: string;
  readonly invoiceNumber: string | null;
  readonly reference: string | null;
  readonly status: InvoiceStatus;
  readonly currencyCode: string;
  readonly subTotal: number;
  readonly totalTax: number;
  readonly total: number;
  readonly amountPaid: number;
  readonly issuedDate: Date;
  readonly dueDate: Date | null;
  readonly xeroUpdatedAt: Date | null;
  /** Who the bill is from, as the Xero contact says. */
  readonly contact: {
    readonly name: string | null;
    /** The ABN, for an Australian contact. */
    readonly taxNumber: string | null;
    readonly emails: readonly string[];
  };
};

export type TradieBillSyncResult =
  /** Not from anyone in the tradie directory: a bookkeeper's own bill. */
  | { readonly kind: "not-a-tradie" }
  /** A tradie's, but on no project we could pin it to. */
  | {
      readonly kind: "unmatched";
      readonly tradieId: string;
      readonly tradieName: string;
      readonly subTotalCents: number;
    }
  | { readonly kind: "stale"; readonly invoiceId: string }
  | {
      readonly kind: "created" | "updated" | "adopted";
      readonly invoiceId: string;
      readonly projectId: string;
      readonly projectName: string;
      readonly tradieName: string;
      readonly scheduleId: string | null;
      readonly subTotalCents: number;
    };

const digits = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

/** The directory entry a Xero contact is, by ABN first and then email. */
async function tradieForContact(
  contact: ExternalTradieBill["contact"],
  db: DomainDb,
) {
  const select = { email: true, id: true, name: true } as const;
  const abn = digits(contact.taxNumber);
  if (abn.length === 11) {
    // Stored as typed, so with spaces or without; compared on the digits.
    // The last group of an ABN (11 222 333 444) is never split by a space, so
    // it narrows the read without missing anyone.
    const candidates = await db.tradie.findMany({
      select: { ...select, abn: true },
      where: { abn: { contains: abn.slice(-3) } },
    });
    const match = candidates.find((tradie) => digits(tradie.abn) === abn);
    if (match) return match;
  }
  const emails = contact.emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return null;
  return db.tradie.findFirst({
    select,
    where: {
      OR: [
        { email: { in: emails, mode: "insensitive" } },
        { additionalEmails: { hasSome: emails } },
      ],
    },
  });
}

type Placement = {
  readonly tradie: { readonly id: string; readonly name: string };
  readonly projectId: string | null;
  readonly scheduleId: string | null;
};

/**
 * Which project and booking a bill is for.
 *
 * In order of how sure it is: the RCTBK reference names one booking; an RCTRQ
 * reference names one tradie's request; failing both, a tradie with committed
 * bookings on a single project is billing that project, and on a single
 * booking there, that booking. A reference to another tradie's booking than
 * the contact's is ignored — the contact is who is asking to be paid.
 */
async function placeBill(
  bill: ExternalTradieBill,
  db: DomainDb,
): Promise<Placement | null> {
  const contactTradie = await tradieForContact(bill.contact, db);
  const token = extractTradieRefToken(bill.reference, bill.invoiceNumber);

  if (token && tradieRefKind(token) === "booking") {
    const schedule = await db.tradieSchedule.findUnique({
      select: {
        id: true,
        projectId: true,
        tradie: { select: { id: true, name: true } },
      },
      where: { refToken: token },
    });
    if (schedule && (!contactTradie || contactTradie.id === schedule.tradie.id))
      return {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        tradie: schedule.tradie,
      };
  }
  if (token && tradieRefKind(token) === "request") {
    const recipient = await db.tradieRequestRecipient.findUnique({
      select: {
        request: { select: { projectId: true } },
        schedules: { select: { id: true, status: true } },
        tradie: { select: { id: true, name: true } },
      },
      where: { refToken: token },
    });
    if (
      recipient
      && (!contactTradie || contactTradie.id === recipient.tradie.id)
    ) {
      const committed = recipient.schedules.filter((schedule) =>
        isCommittedBooking(schedule.status),
      );
      return {
        projectId: recipient.request.projectId,
        scheduleId: committed.length === 1 ? committed[0].id : null,
        tradie: recipient.tradie,
      };
    }
  }
  if (!contactTradie) return null;

  const committed = await db.tradieSchedule.findMany({
    select: { id: true, projectId: true, status: true },
    where: { tradieId: contactTradie.id },
  });
  const live = committed.filter((schedule) =>
    isCommittedBooking(schedule.status),
  );
  const projects = [...new Set(live.map((schedule) => schedule.projectId))];
  if (projects.length !== 1) {
    return { projectId: null, scheduleId: null, tradie: contactTradie };
  }
  return {
    projectId: projects[0],
    scheduleId: live.length === 1 ? live[0].id : null,
    tradie: contactTradie,
  };
}

function billFields(bill: ExternalTradieBill) {
  return {
    amountPaid: new Prisma.Decimal(toCents(bill.amountPaid)).div(100),
    currencyCode: bill.currencyCode,
    dueDate: bill.dueDate,
    invoiceNumber: invoiceNumberKey(bill.invoiceNumber),
    issuedDate: bill.issuedDate,
    reference: bill.reference,
    status: bill.status,
    subTotal: new Prisma.Decimal(toCents(bill.subTotal)).div(100),
    total: new Prisma.Decimal(toCents(bill.total)).div(100),
    totalTax: new Prisma.Decimal(toCents(bill.totalTax)).div(100),
    xeroInvoiceId: bill.xeroInvoiceId,
    xeroUpdatedAt: bill.xeroUpdatedAt,
  };
}

/**
 * Mirror one Xero bill onto the tradie invoices, monotonically.
 *
 * Called by the invoice webhook for an invoice that is not one of our
 * progress claims and that Xero says is a bill. A bill already mirrored is
 * updated in place — never older over newer, never back down the status
 * ladder — and one still waiting for a booking is placed again, because the
 * bookkeeper adding the RCTBK reference is how it gets placed.
 *
 * A new bill that matches a live invoice the office already typed in (same
 * tradie, same number) adopts that row rather than adding a second: the job
 * was charged once. The office's allocation stays.
 */
export async function syncTradieBillFromExternal(
  principal: DomainPrincipal,
  bill: ExternalTradieBill,
  db: DomainDb,
): Promise<TradieBillSyncResult> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Xero bills are only mirrored by the Xero webhook.",
    );
  }
  const subTotalCents = toCents(bill.subTotal);
  const projectSelect = { select: { name: true } } as const;

  const existing = await db.tradieInvoice.findUnique({
    select: {
      id: true,
      project: projectSelect,
      projectId: true,
      scheduleId: true,
      status: true,
      tradie: { select: { id: true, name: true } },
      xeroUpdatedAt: true,
    },
    where: { xeroInvoiceId: bill.xeroInvoiceId },
  });
  if (existing) {
    if (
      (existing.xeroUpdatedAt
        && bill.xeroUpdatedAt
        && bill.xeroUpdatedAt <= existing.xeroUpdatedAt)
      || invoiceStatusRank(bill.status) < invoiceStatusRank(existing.status)
    ) {
      return { invoiceId: existing.id, kind: "stale" };
    }
    let scheduleId = existing.scheduleId;
    if (!scheduleId) {
      const placement = await placeBill(bill, db);
      if (
        placement?.scheduleId
        && placement.projectId === existing.projectId
        && placement.tradie.id === existing.tradie.id
      ) {
        scheduleId = placement.scheduleId;
      }
    }
    await db.tradieInvoice.update({
      data: { ...billFields(bill), scheduleId },
      where: { id: existing.id },
    });
    if (scheduleId && !existing.scheduleId) {
      await logPlacedBill(principal, { ...bill, scheduleId }, db);
    }
    return {
      invoiceId: existing.id,
      kind: "updated",
      projectId: existing.projectId,
      projectName: existing.project.name,
      scheduleId,
      subTotalCents,
      tradieName: existing.tradie.name,
    };
  }

  const placement = await placeBill(bill, db);
  if (!placement) return { kind: "not-a-tradie" };
  if (!placement.projectId) {
    return {
      kind: "unmatched",
      subTotalCents,
      tradieId: placement.tradie.id,
      tradieName: placement.tradie.name,
    };
  }
  const project = await db.project.findUniqueOrThrow({
    select: { name: true },
    where: { id: placement.projectId },
  });

  const invoiceNumber = invoiceNumberKey(bill.invoiceNumber);
  const typedIn = invoiceNumber
    ? await db.tradieInvoice.findFirst({
        select: { id: true, projectId: true, scheduleId: true },
        where: {
          invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
          status: { notIn: [InvoiceStatus.VOIDED, InvoiceStatus.DELETED] },
          tradieId: placement.tradie.id,
          xeroInvoiceId: null,
        },
      })
    : null;
  if (typedIn) {
    const adopted = await db.tradieInvoice.update({
      data: {
        ...billFields(bill),
        scheduleId: typedIn.scheduleId ?? placement.scheduleId,
        source: TradieInvoiceSource.XERO,
      },
      select: { project: projectSelect, projectId: true, scheduleId: true },
      where: { id: typedIn.id },
    });
    return {
      invoiceId: typedIn.id,
      kind: "adopted",
      projectId: adopted.projectId,
      projectName: adopted.project.name,
      scheduleId: adopted.scheduleId,
      subTotalCents,
      tradieName: placement.tradie.name,
    };
  }

  const created = await db.tradieInvoice.create({
    data: {
      ...billFields(bill),
      projectId: placement.projectId,
      scheduleId: placement.scheduleId,
      source: TradieInvoiceSource.XERO,
      tradieId: placement.tradie.id,
    },
    select: { id: true },
  });
  if (placement.scheduleId) {
    await logPlacedBill(
      principal,
      { ...bill, scheduleId: placement.scheduleId },
      db,
    );
  }
  return {
    invoiceId: created.id,
    kind: "created",
    projectId: placement.projectId,
    projectName: project.name,
    scheduleId: placement.scheduleId,
    subTotalCents,
    tradieName: placement.tradie.name,
  };
}

async function logPlacedBill(
  principal: DomainPrincipal,
  bill: ExternalTradieBill & { readonly scheduleId: string },
  db: DomainDb,
) {
  const schedule = await db.tradieSchedule.findUniqueOrThrow({
    select: { milestoneId: true, projectId: true, tradieId: true },
    where: { id: bill.scheduleId },
  });
  await recordTradieActivity(
    {
      data: {
        amount: amount(toCents(bill.subTotal)),
        invoiceNumber: invoiceNumberKey(bill.invoiceNumber),
        milestoneId: schedule.milestoneId,
        projectId: schedule.projectId,
        scheduleId: bill.scheduleId,
        source: TradieInvoiceSource.XERO,
        tradieId: schedule.tradieId,
        via: principal.kind === "system" ? principal.reason : null,
      },
      principal,
      type: "invoiceRecorded",
    },
    db,
  );
}
