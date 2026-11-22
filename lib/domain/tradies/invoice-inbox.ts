import {
  GraphMailbox,
  InvoiceStatus,
  Prisma,
  TradieInvoiceInboxStatus,
} from "@prisma/client";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import { isSignatureNoise } from "../email/attachment-noise";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../errors";
import {
  attributionUserId,
  isInternalPrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { toCents, type Cents } from "./billing-rules";
import { TRADIE_INVOICE_DOCUMENT_TYPES } from "./invoice-document-files";
import { placeTradieInvoice } from "./invoices";
import { extractTradieRefToken } from "./reply-reference";

// Tradie invoices that arrive by email.
//
// A tradie emails an invoice as a PDF or a photo. The inbound mail workflow
// (lib/workflow/tradie-invoice-email.ts) reads each attachment and, when it
// is an invoice, queues it here against the project and booking it bills.
// Queued is all: nothing in this table counts in what a job has been invoiced.
// The office confirms it on the Financials tab, which records a TradieInvoice
// through `recordTradieInvoice` — the same duplicate, GST and booking rules as
// typing one in — and marks the entry confirmed in the same transaction.
//
// Why not record it straight away: the reading is OCR and a model, and a
// wrong amount or the wrong booking would quietly move a job's margin with
// nobody having looked. The office is three people; one look is cheap.

/** Larger than any real invoice; bounds what one workflow step downloads. */
export const EMAILED_INVOICE_MAX_BYTES = 20 * 1024 * 1024;

export type EmailAttachment = {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly isInline: boolean;
  readonly contentId?: string | null;
  readonly odataType?: string | null;
};

export type InvoiceAttachmentCandidate = {
  readonly id: string;
  readonly name: string;
  readonly contentType: (typeof TRADIE_INVOICE_DOCUMENT_TYPES)[number];
  readonly size: number;
};

/**
 * The attachments that could be an invoice: real files, not a signature logo
 * pasted inline or a forwarded email, as a PDF or an image, within the size
 * bound. A PDF some mail clients send as octet-stream is read by its name.
 */
export function invoiceAttachmentCandidates(
  attachments: readonly EmailAttachment[],
): InvoiceAttachmentCandidate[] {
  return attachments.flatMap((attachment) => {
    // Inline outright — an invoice is attached, not pasted — and the
    // signature images Graph reports as not inline, which would otherwise be
    // read as a photographed invoice.
    if (attachment.isInline || isSignatureNoise(attachment)) return [];
    if (
      attachment.odataType
      && attachment.odataType !== "#microsoft.graph.fileAttachment"
    ) {
      return [];
    }
    if (attachment.size <= 0 || attachment.size > EMAILED_INVOICE_MAX_BYTES) {
      return [];
    }
    const declared = attachment.contentType.toLowerCase().split(";")[0].trim();
    const contentType =
      TRADIE_INVOICE_DOCUMENT_TYPES.find((type) => type === declared)
      ?? (declared === "application/octet-stream"
      && /\.pdf$/i.test(attachment.name)
        ? "application/pdf"
        : undefined);
    if (!contentType) return [];
    return [
      {
        contentType,
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
      },
    ];
  });
}

function requireInternal(principal: DomainPrincipal) {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Emailed invoices are only queued by the inbound mail workflow.",
    );
  }
}

export type EmailedInvoicePlacement = {
  readonly tradie: { readonly id: string; readonly name: string };
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly scheduleId: string | null;
};

/**
 * Which project and booking a tradie's invoice email is for. The same rule as
 * a Xero bill: a booking or request reference quoted in the subject or body
 * first, then the tradie's single project and single booking on it.
 */
export async function placeEmailedTradieInvoice(
  principal: DomainPrincipal,
  input: {
    readonly tradieId: string;
    readonly subject: string;
    readonly body: string;
  },
  db: DomainDb,
): Promise<EmailedInvoicePlacement> {
  requireInternal(principal);
  const tradie = await db.tradie.findUnique({
    select: { id: true, name: true },
    where: { id: input.tradieId },
  });
  if (!tradie) throw new DomainNotFoundError("Tradie not found.");

  const placement = await placeTradieInvoice(
    { token: extractTradieRefToken(input.subject, input.body), tradie },
    db,
  );
  // A reference to another tradie's booking is ignored by the rule, and the
  // sender is who is asking to be paid, so the tradie stays the sender.
  const projectId = placement?.projectId ?? null;
  const project = projectId
    ? await db.project.findUnique({
        select: { name: true },
        where: { id: projectId },
      })
    : null;
  return {
    projectId: project ? projectId : null,
    projectName: project?.name ?? null,
    scheduleId: project ? (placement?.scheduleId ?? null) : null,
    tradie,
  };
}

export type QueueEmailedInvoiceInput = {
  readonly projectId: string;
  readonly scheduleId: string | null;
  readonly tradieId: string;
  readonly graphMessageId: string;
  readonly attachmentId: string;
  readonly mailbox: "business" | "admin";
  readonly fromAddress: string;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly document: { readonly url: string; readonly name: string };
  readonly invoiceNumber: string | null;
  /** YYYY-MM-DD. */
  readonly issuedDate: string | null;
  readonly dueDate: string | null;
  /** Dollars. */
  readonly subTotal: number | null;
  readonly totalTax: number | null;
  readonly total: number | null;
};

export type QueueEmailedInvoiceOutcome =
  | { readonly outcome: "queued"; readonly inboxId: string }
  /** This attachment was queued before: a redelivered notification. */
  | { readonly outcome: "already-queued"; readonly inboxId: string }
  /** The tradie's invoice with this number is already recorded. */
  | { readonly outcome: "already-recorded" };

function day(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // A date the reader got wrong (2026-13-01, or 2026-02-31, which Date rolls
  // into March) is left for the office to fill in, never stored or thrown on.
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function money(value: number | null): Prisma.Decimal | null {
  return value !== null && Number.isFinite(value) && value >= 0
    ? new Prisma.Decimal(toCents(value)).div(100)
    : null;
}

/**
 * Queue one emailed invoice for the office. Safe to run twice for the same
 * attachment: the email and attachment ids are unique together.
 */
export async function queueEmailedTradieInvoice(
  principal: DomainPrincipal,
  input: QueueEmailedInvoiceInput,
  db: DomainDb,
): Promise<QueueEmailedInvoiceOutcome> {
  requireInternal(principal);

  const existing = await db.tradieInvoiceInbox.findUnique({
    select: { id: true },
    where: {
      graphMessageId_attachmentId: {
        attachmentId: input.attachmentId,
        graphMessageId: input.graphMessageId,
      },
    },
  });
  if (existing) return { inboxId: existing.id, outcome: "already-queued" };

  // Already typed in, or mirrored from Xero: queueing it would only ask the
  // office to refuse a duplicate.
  const invoiceNumber = input.invoiceNumber?.trim() || null;
  if (invoiceNumber) {
    const recorded = await db.tradieInvoice.findFirst({
      select: { id: true },
      where: {
        invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
        status: { notIn: [InvoiceStatus.VOIDED, InvoiceStatus.DELETED] },
        tradieId: input.tradieId,
      },
    });
    if (recorded) return { outcome: "already-recorded" };
  }

  try {
    const created = await db.tradieInvoiceInbox.create({
      data: {
        attachmentId: input.attachmentId,
        documentName: input.document.name,
        documentUrl: input.document.url,
        dueDate: day(input.dueDate),
        fromAddress: input.fromAddress,
        graphMessageId: input.graphMessageId,
        invoiceNumber,
        issuedDate: day(input.issuedDate),
        mailbox:
          input.mailbox === "admin"
            ? GraphMailbox.ADMIN
            : GraphMailbox.BUSINESS,
        projectId: input.projectId,
        receivedAt: input.receivedAt,
        scheduleId: input.scheduleId,
        subTotal: money(input.subTotal),
        subject: input.subject.slice(0, 500),
        total: money(input.total),
        totalTax: money(input.totalTax),
        tradieId: input.tradieId,
      },
      select: { id: true },
    });
    return { inboxId: created.id, outcome: "queued" };
  } catch (error) {
    // Two deliveries of one notification racing past the read above.
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      const raced = await db.tradieInvoiceInbox.findUnique({
        select: { id: true },
        where: {
          graphMessageId_attachmentId: {
            attachmentId: input.attachmentId,
            graphMessageId: input.graphMessageId,
          },
        },
      });
      if (raced) return { inboxId: raced.id, outcome: "already-queued" };
    }
    throw error;
  }
}

async function pendingEntry(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly inboxId: string },
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);
  const entry = await db.tradieInvoiceInbox.findUnique({
    select: { id: true, projectId: true, status: true },
    where: { id: input.inboxId },
  });
  if (!entry || entry.projectId !== input.projectId) {
    throw new DomainNotFoundError(
      "That emailed invoice is not on this project.",
    );
  }
  if (entry.status !== TradieInvoiceInboxStatus.PENDING) {
    throw new DomainTransitionError(
      `This emailed invoice was already ${entry.status.toLowerCase()}.`,
      entry.status,
      TradieInvoiceInboxStatus.CONFIRMED,
    );
  }
  return entry;
}

/** Settle an entry, refusing one somebody else settled first. */
async function settle(
  principal: DomainPrincipal,
  entryId: string,
  data: { status: TradieInvoiceInboxStatus; invoiceId?: string },
  db: DomainDb,
) {
  const settled = await db.tradieInvoiceInbox.updateMany({
    data: {
      ...data,
      decidedAt: new Date(),
      decidedById: attributionUserId(principal),
    },
    where: { id: entryId, status: TradieInvoiceInboxStatus.PENDING },
  });
  if (settled.count !== 1) {
    throw new DomainTransitionError(
      "This emailed invoice was settled in another tab.",
      TradieInvoiceInboxStatus.PENDING,
      data.status,
    );
  }
}

/**
 * Mark an emailed invoice as recorded. Called in the same transaction as the
 * `recordTradieInvoice` that recorded it, so a refusal here undoes that too.
 */
export async function confirmEmailedTradieInvoice(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly inboxId: string;
    readonly invoiceId: string;
  },
  db: DomainDb,
): Promise<void> {
  const entry = await pendingEntry(principal, input, db);
  await settle(
    principal,
    entry.id,
    {
      invoiceId: input.invoiceId,
      status: TradieInvoiceInboxStatus.CONFIRMED,
    },
    db,
  );
}

/** Set an emailed invoice aside: a duplicate, or not this job's to pay. */
export async function dismissEmailedTradieInvoice(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly inboxId: string },
  db: DomainDb,
): Promise<{ readonly projectId: string }> {
  const entry = await pendingEntry(principal, input, db);
  await settle(
    principal,
    entry.id,
    { status: TradieInvoiceInboxStatus.DISMISSED },
    db,
  );
  return { projectId: entry.projectId };
}

/** An emailed invoice waiting for the office, as the Financials tab shows it. */
export type EmailedTradieInvoice = {
  readonly id: string;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly scheduleId: string | null;
  readonly fromAddress: string;
  readonly subject: string;
  /** ISO. */
  readonly receivedAt: string;
  readonly documentUrl: string;
  readonly documentName: string;
  readonly invoiceNumber: string | null;
  /** YYYY-MM-DD. */
  readonly issuedDate: string | null;
  readonly dueDate: string | null;
  readonly subTotalCents: Cents | null;
  readonly totalTaxCents: Cents | null;
  readonly totalCents: Cents | null;
};

const ymd = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

/** How long an emailed invoice may wait before the office is nudged, and how often after. */
export const STALE_INVOICE_REMIND_EVERY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an invoice that arrived at `receivedAt` is due a nudge today.
 *
 * Stateless on purpose: the daily cron asks, and the answer is yes on day 3, 6,
 * 9… so there is no "last reminded" column to keep honest. A skipped run costs
 * one reminder, which is the right size for an internal prompt.
 */
export function invoiceReminderDue(receivedAt: Date, now: Date): boolean {
  const days = Math.floor((now.getTime() - receivedAt.getTime()) / DAY_MS);
  return days >= STALE_INVOICE_REMIND_EVERY_DAYS
    && days % STALE_INVOICE_REMIND_EVERY_DAYS === 0;
}

export type StaleInvoiceReminder = {
  readonly projectId: string;
  readonly projectName: string;
  readonly count: number;
  readonly oldestDays: number;
};

/**
 * Projects with emailed invoices still PENDING that are due a nudge today.
 *
 * The only alert at arrival is one in-app notification, and a $350 invoice sat
 * unconfirmed for 17 days after it (#588). Nothing counts until the office
 * confirms, so a forgotten one is money not tracked, not a wrong figure.
 */
export async function staleInvoiceReminders(
  db: DomainDb,
  now: Date,
): Promise<StaleInvoiceReminder[]> {
  const rows = await db.tradieInvoiceInbox.findMany({
    select: {
      projectId: true,
      project: { select: { name: true } },
      receivedAt: true,
    },
    where: {
      receivedAt: {
        lte: new Date(now.getTime() - STALE_INVOICE_REMIND_EVERY_DAYS * DAY_MS),
      },
      status: TradieInvoiceInboxStatus.PENDING,
    },
  });

  // One message per project, due on the day its OLDEST waiting invoice is;
  // the count covers everything pending there.
  const byProject = new Map<
    string,
    { count: number; name: string; oldest: Date }
  >();
  for (const row of rows) {
    const current = byProject.get(row.projectId);
    byProject.set(row.projectId, {
      count: (current?.count ?? 0) + 1,
      name: row.project.name,
      oldest:
        current && current.oldest < row.receivedAt
          ? current.oldest
          : row.receivedAt,
    });
  }
  return [...byProject.entries()]
    .filter(([, entry]) => invoiceReminderDue(entry.oldest, now))
    .map(([projectId, entry]) => ({
      count: entry.count,
      oldestDays: Math.floor((now.getTime() - entry.oldest.getTime()) / DAY_MS),
      projectId,
      projectName: entry.name,
    }));
}

/** The project's emailed invoices still waiting for the office, oldest first. */
export async function listPendingEmailedInvoices(
  projectId: string,
  db: DomainDb,
): Promise<EmailedTradieInvoice[]> {
  const rows = await db.tradieInvoiceInbox.findMany({
    orderBy: { receivedAt: "asc" },
    select: {
      documentName: true,
      documentUrl: true,
      dueDate: true,
      fromAddress: true,
      id: true,
      invoiceNumber: true,
      issuedDate: true,
      receivedAt: true,
      scheduleId: true,
      subTotal: true,
      subject: true,
      total: true,
      totalTax: true,
      tradie: { select: { id: true, name: true } },
    },
    where: { projectId, status: TradieInvoiceInboxStatus.PENDING },
  });
  return rows.map((row) => ({
    documentName: row.documentName,
    documentUrl: row.documentUrl,
    dueDate: ymd(row.dueDate),
    fromAddress: row.fromAddress,
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    issuedDate: ymd(row.issuedDate),
    receivedAt: row.receivedAt.toISOString(),
    scheduleId: row.scheduleId,
    subTotalCents: row.subTotal === null ? null : toCents(row.subTotal),
    subject: row.subject,
    totalCents: row.total === null ? null : toCents(row.total),
    totalTaxCents: row.totalTax === null ? null : toCents(row.totalTax),
    tradieId: row.tradie.id,
    tradieName: row.tradie.name,
  }));
}
