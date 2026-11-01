import {
  OutboxEventKind,
  Prisma,
  VariationKind,
  VariationStatus,
} from "@prisma/client";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "../errors";
import { CLIENT_PAYMENT_TERMS_DAYS } from "../invoices/stage-creation";
import { runOutboxEffectWithOutcome } from "../outbox";
import type {
  VariationInvoiceFields,
  VariationIssuePorts,
} from "../ports/variation";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { toCents } from "../tradies/billing-rules";
import { loadVariationContext, variationDocumentData } from "./variation-raise";
import { formatVariationNumber } from "./variation-rules";

// Issuing a raised variation: the Xero invoice, the document, the email.
//
// Three external effects, in this order, each recorded on the row as it lands
// so that a retry only does what is left:
//
//   1. Xero, for a chargeable variation only. First, because the document
//      prints the invoice number the client will pay against.
//   2. The document, rendered and archived. Overwrites one fixed path, so a
//      second render is the same end state.
//   3. The email to each owner, the document attached.
//
// A step that fails stops the rest and writes what went wrong onto the row.
// The office sees it on the Variations tab with a retry beside it; the
// adapter also answers with the refusal. Nothing reports "sent" unless the
// email went — with three people and no on-call, a variation the client never
// received has to be visible, not logged.

export type IssueVariationInput = {
  readonly projectId: string;
  readonly variationId: string;
  /**
   * The browser's key for this press of Send or Resend. The email is keyed
   * on it, so a replayed request does not email the client twice, while a
   * resend somebody chose to press is a new email.
   */
  readonly emailAttemptKey: string;
  /** Owners to email, by address. Defaults to every owner with one. */
  readonly recipients?: readonly string[];
  /** Email it again even though it was sent before. */
  readonly resend?: boolean;
};

export type IssuedVariation = {
  readonly id: string;
  readonly projectId: string;
  readonly number: string;
  readonly kind: VariationKind;
  readonly invoiceNumber: string | null;
  readonly documentUrl: string;
  /** Who this call emailed. Empty when the email was already sent. */
  readonly emailedTo: readonly string[];
  /** The email for this attempt key had already gone; nothing was re-sent. */
  readonly emailReplayed: boolean;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write the failure on the row, then refuse with it. */
async function failStep(
  db: DomainDb,
  variationId: string,
  port: string,
  operatorMessage: string,
  cause: unknown,
): Promise<never> {
  await db.variation.update({
    data: { issueError: operatorMessage },
    where: { id: variationId },
  });
  if (isDomainError(cause) && !(cause instanceof DomainSideEffectError)) {
    // The outbox refusing a retry already says what to do; keep its words.
    throw cause;
  }
  throw new DomainSideEffectError(operatorMessage, port, true, { cause });
}

export async function issueVariation(
  principal: DomainPrincipal,
  input: IssueVariationInput,
  db: DomainDb,
  ports: VariationIssuePorts,
  now: Date = new Date(),
): Promise<IssuedVariation> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);

  const row = await db.variation.findFirst({
    where: { id: input.variationId, projectId: input.projectId },
  });
  if (!row) {
    throw new DomainNotFoundError(
      "That variation does not belong to this project.",
    );
  }
  if (row.status !== VariationStatus.APPROVED) {
    throw new DomainTransitionError(
      "Only an approved variation is sent to the client.",
      row.status,
      "ISSUED",
    );
  }
  if (row.previousPrice === null || row.newPrice === null) {
    throw new DomainTransitionError(
      "This variation was logged before variations priced an activity, so there is no document to send for it.",
      row.status,
      "ISSUED",
    );
  }
  const emailAttemptKey = input.emailAttemptKey.trim();
  if (!emailAttemptKey) {
    throw new DomainValidationError("An email attempt key is required.");
  }

  const context = await loadVariationContext(input.projectId, db);
  const number = formatVariationNumber(row.number);
  const dueDate = new Date(row.approvedDate ?? now);
  dueDate.setDate(dueDate.getDate() + CLIENT_PAYMENT_TERMS_DAYS);

  // Chosen before anything is sent, so a typo'd selection fails on the
  // screen rather than after the invoice is already in Xero.
  const owners = context.owners;
  // Who the office chose: this call's list, else the one saved when it was
  // raised — so a retry after a failed invoice still emails only them — and
  // every owner only for a variation that never had a choice made.
  const chosen = input.recipients?.length
    ? input.recipients
    : (row.recipients ?? []);
  const wanted = chosen.length
    ? chosen.map((email) => email.trim().toLowerCase())
    : owners.map((owner) => owner.email.toLowerCase());
  const recipients = owners
    .map((owner) => owner.email)
    .filter((email) => wanted.includes(email.toLowerCase()));
  const strangers = wanted.filter(
    (email) => !owners.some((owner) => owner.email.toLowerCase() === email),
  );
  if (strangers.length > 0) {
    throw new DomainValidationError(
      "A variation is only emailed to the owners on the contract.",
      "recipients",
    );
  }
  const needsEmail = row.sentAt === null || input.resend === true;
  if (needsEmail && recipients.length === 0) {
    throw new DomainValidationError(
      "No owner on this contract has an email address. Add one on the Overview tab first.",
      "recipients",
    );
  }
  const invalid = recipients.find((email) => !EMAIL_RE.test(email));
  if (needsEmail && invalid) {
    throw new DomainValidationError(
      `"${invalid}" is not an email address. Correct it on the Overview tab.`,
      "recipients",
    );
  }
  // A retry finishes a send that failed part-way: owners it already reached
  // are not emailed a second time. A resend is deliberate, and goes to
  // everyone chosen.
  const reached = input.resend ? [] : row.sentTo;
  const reachedKeys = new Set(reached.map((email) => email.toLowerCase()));
  const toSend = recipients.filter(
    (email) => !reachedKeys.has(email.toLowerCase()),
  );

  // 1. Xero.
  let invoice: {
    number: string | null;
    xeroInvoiceId: string | null;
  } = { number: row.xeroInvoiceNumber, xeroInvoiceId: row.xeroInvoiceId };
  if (row.kind === VariationKind.CHARGEABLE && !row.xeroInvoiceId) {
    const document = variationDocumentData(context, {
      description: row.description,
      dueDate,
      invoiceNumber: null,
      kind: row.kind,
      milestoneId: row.milestoneId,
      newPriceCents: toCents(row.newPrice),
      number: row.number,
      previousPriceCents: toCents(row.previousPrice),
      requestedDate: row.requestedDate,
    });
    try {
      const { result } = await runOutboxEffectWithOutcome(
        db,
        {
          key: `variation-invoice:${row.id}`,
          kind: OutboxEventKind.VARIATION_INVOICE_ISSUE,
          payload: {
            amountExGstCents: document.chargeExGstCents,
            projectId: row.projectId,
            variationId: row.id,
          },
        },
        async () => {
          const fields = await ports.raiseInvoice({
            amountExGstCents: document.chargeExGstCents,
            dueDate,
            issuedDate: row.approvedDate ?? now,
            lineDescription: `Variation ${number} — ${document.activityName}: ${document.reason}`,
            projectId: row.projectId,
            reference: variationInvoiceReference(number, row.id),
            variationId: row.id,
          });
          await db.variation.update({
            data: invoiceData(fields),
            where: { id: row.id },
          });
          return {
            invoiceNumber: fields.invoiceNumber,
            xeroInvoiceId: fields.xeroInvoiceId,
          };
        },
        // Repeatable because the port looks the invoice up by its reference
        // before creating one: a retry after a lost response adopts the
        // invoice already in Xero instead of billing the client twice.
        { repeatable: true },
      );
      invoice = {
        number: result.invoiceNumber,
        xeroInvoiceId: result.xeroInvoiceId,
      };
    } catch (error) {
      return failStep(
        db,
        row.id,
        "xero",
        `The Xero invoice was not raised: ${message(error)}`,
        error,
      );
    }
  }

  const document = variationDocumentData(context, {
    description: row.description,
    dueDate: row.kind === VariationKind.CHARGEABLE ? dueDate : null,
    invoiceNumber: invoice.number,
    kind: row.kind,
    milestoneId: row.milestoneId,
    newPriceCents: toCents(row.newPrice),
    number: row.number,
    previousPriceCents: toCents(row.previousPrice),
    requestedDate: row.requestedDate,
  });

  // 2. The document.
  let documentUrl = row.documentUrl;
  if (!documentUrl) {
    try {
      ({ url: documentUrl } = await ports.storeDocument({
        document,
        projectId: row.projectId,
        variationId: row.id,
      }));
    } catch (error) {
      return failStep(
        db,
        row.id,
        "document",
        `The variation document could not be created: ${message(error)}`,
        error,
      );
    }
    await db.variation.update({
      data: { documentUrl },
      where: { id: row.id },
    });
  }

  // 3. The email. `sentAt` is set only once every chosen owner has it; until
  // then the variation reads as not sent, and `sentTo` says who has.
  let emailedTo: readonly string[] = [];
  let emailReplayed = false;
  const reachedNow = (delivered: readonly string[]) => {
    const all = [...reached];
    for (const email of delivered) {
      if (!all.some((had) => had.toLowerCase() === email.toLowerCase())) {
        all.push(email);
      }
    }
    return all;
  };
  if (needsEmail && toSend.length === 0) {
    // An earlier attempt reached everyone before failing to record it.
    await db.variation.update({
      data: { sentAt: now, sentTo: reachedNow([]) },
      where: { id: row.id },
    });
  } else if (needsEmail) {
    const subject = variationEmailSubject(document);
    const delivered: string[] = [];
    let landed: readonly string[] = [];
    try {
      const { result, replayed } = await runOutboxEffectWithOutcome(
        db,
        {
          key: `variation-email:${row.id}:${emailAttemptKey}`,
          kind: OutboxEventKind.VARIATION_EMAIL_SEND,
          payload: { recipients: toSend, subject, variationId: row.id },
        },
        async () => {
          for (const to of toSend) {
            await ports.sendEmail({
              document,
              documentUrl: documentUrl as string,
              subject,
              to,
            });
            delivered.push(to);
          }
          return { recipients: delivered };
        },
      );
      landed = result.recipients;
      emailedTo = replayed ? [] : result.recipients;
      emailReplayed = replayed;
    } catch (error) {
      const partial =
        delivered.length > 0
          ? ` It reached ${delivered.join(", ")} before failing.`
          : "";
      if (delivered.length > 0) {
        await db.variation.update({
          data: { sentTo: reachedNow(delivered) },
          where: { id: row.id },
        });
      }
      return failStep(
        db,
        row.id,
        "email",
        `The email to the client was not sent: ${message(error)}.${partial}`,
        error,
      );
    }
    await db.variation.update({
      data: { sentAt: now, sentTo: reachedNow(landed) },
      where: { id: row.id },
    });
  }

  await db.variation.update({
    data: { issueError: null },
    where: { id: row.id },
  });

  return {
    documentUrl,
    emailReplayed,
    emailedTo,
    id: row.id,
    invoiceNumber: invoice.number,
    kind: row.kind,
    number,
    projectId: row.projectId,
  };
}

/**
 * The Xero reference on a variation's invoice, and the key a retry finds it
 * by: "Variation V-003 RCV-1A2B3C4D5E6F". The token comes from the variation's
 * own id, so it is unique even between two projects billed to one Xero
 * contact, and nothing a person can rename changes it.
 */
export function variationInvoiceReference(
  number: string,
  variationId: string,
): string {
  const token = variationId.replace(/-/g, "").slice(0, 12).toUpperCase();
  return `Variation ${number} RCV-${token}`;
}

/** "Variation V-003 — 12 Smith St: Roof framing". */
export function variationEmailSubject(document: {
  readonly number: string;
  readonly siteAddress: string;
  readonly activityName: string;
}): string {
  return `Variation ${document.number} — ${document.siteAddress}: ${document.activityName}`;
}

function invoiceData(fields: VariationInvoiceFields) {
  return {
    invoiceAmountPaid: new Prisma.Decimal(fields.amountPaidCents / 100),
    invoiceStatus: fields.status,
    invoiceTax: new Prisma.Decimal(fields.taxCents / 100),
    invoiceTotal: new Prisma.Decimal(fields.totalCents / 100),
    xeroInvoiceId: fields.xeroInvoiceId,
    xeroInvoiceNumber: fields.invoiceNumber,
    xeroUpdatedAt: fields.updatedAt,
  };
}

export type VariationInvoiceSyncResult =
  | { readonly kind: "unknown" }
  | { readonly kind: "stale" }
  | { readonly kind: "updated"; readonly projectId: string };

/**
 * Apply a Xero invoice webhook to the variation it bills, if it bills one.
 * Monotonic on Xero's own timestamp, like the stage claims: a replayed or
 * out-of-order delivery cannot drag a PAID variation back to AUTHORISED.
 */
export async function syncVariationInvoiceFromExternal(
  xeroInvoiceId: string,
  db: DomainDb,
  fetchInvoice: () => Promise<VariationInvoiceFields | null>,
): Promise<VariationInvoiceSyncResult> {
  const existing = await db.variation.findUnique({
    select: { id: true, projectId: true, xeroUpdatedAt: true },
    where: { xeroInvoiceId },
  });
  if (!existing) return { kind: "unknown" };

  const fields = await fetchInvoice();
  if (!fields) return { kind: "stale" };
  if (
    existing.xeroUpdatedAt
    && fields.updatedAt
    && fields.updatedAt.getTime() < existing.xeroUpdatedAt.getTime()
  ) {
    return { kind: "stale" };
  }
  await db.variation.update({
    data: invoiceData(fields),
    where: { id: existing.id },
  });
  return { kind: "updated", projectId: existing.projectId };
}
