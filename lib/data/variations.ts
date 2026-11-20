import "server-only";

import { after } from "next/server";
import { revalidateTag } from "next/cache";

import { render } from "@react-email/components";
import { put } from "@/lib/blob";
import { format } from "date-fns";
import { createElement } from "react";
import { Invoice, type Invoices, LineAmountTypes } from "xero-node";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { logAction } from "@/lib/domain/audit/action-log";
import { filterOfficeUserIds } from "@/lib/domain/identity/users";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { attributionUserId } from "@/lib/domain/principal";
import type {
  VariationDocumentData,
  VariationInvoiceFields,
  VariationIssuePorts,
} from "@/lib/domain/ports/variation";
import {
  syncVariationInvoiceFromExternal,
  type VariationInvoiceSyncResult,
} from "@/lib/domain/projects/variation-issue";
import type { RaisedVariation } from "@/lib/domain/projects/variation-raise";
import {
  decideVariation,
  type VariationDecision,
} from "@/lib/domain/projects/variations";
import { toCents } from "@/lib/domain/tradies/billing-rules";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import VariationInvoiceEmail from "@/lib/graph/Email/variation-invoice-email";
import { triggerNotification } from "@/lib/notification/novu";
import { generatePDF } from "@/lib/pdf/generate-pdf";
import { buildVariationDocumentHtml } from "@/lib/projects/variation-document-html";
import { getXeroContext, type XeroContext } from "@/lib/xero/client";
import { getXeroConfig } from "@/lib/xero/config";
import { resolveProjectXeroContactId } from "@/lib/xero/contact";
import { toInvoiceStatus } from "@/lib/xero/invoice-status";
import { parseXeroDate } from "@/lib/xero/xero-date";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import { currency } from "@/utils/formatters";

// The Next adapter over the variation commands in `lib/domain/projects/`.
//
// The rules — what a variation may price, who pays, the order its effects
// land in and what a retry repeats — are in the domain. This file is the
// providers behind the domain's ports (Xero, Chromium and Blob, Graph) and the
// post-commit work only a request can do: the activity log, the notification
// and the cache tag.

/** The project page and the projects list read variations from their cache. */
export function expireVariationProject(projectId: string) {
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
}

export function variationInvoiceFieldsFromXero(
  invoice: Invoice,
): VariationInvoiceFields {
  return {
    amountPaidCents: toCents(invoice.amountPaid ?? 0),
    invoiceNumber: invoice.invoiceNumber ?? null,
    status: toInvoiceStatus(invoice.status) ?? "DRAFT",
    taxCents: toCents(invoice.totalTax ?? 0),
    totalCents: toCents(invoice.total ?? 0),
    updatedAt: parseXeroDate(invoice.updatedDateUTC),
    xeroInvoiceId: invoice.invoiceID as string,
  };
}

const NO_INVOICE_ID = "00000000-0000-0000-0000-000000000000";

async function raiseXeroInvoice(
  input: Parameters<VariationIssuePorts["raiseInvoice"]>[0],
): Promise<VariationInvoiceFields> {
  // An AUTHORISED invoice must post to a revenue account; checked before
  // anything reaches Xero so a missing setting is a plain refusal.
  const config = getXeroConfig();
  if (!config.salesAccountCode) {
    throw new Error(
      "Xero invoicing is not configured — set XERO_SALES_ACCOUNT_CODE to the revenue account variations should post to.",
    );
  }
  const context = await getXeroContext();
  const contactID = await resolveProjectXeroContactId(context, input.projectId);

  // Adopt an invoice already raised for this variation — the response to an
  // earlier attempt may have been lost after Xero accepted it. This is what
  // lets the domain retry this step without billing the client twice.
  const found = await context.xero.accountingApi.getInvoices(
    context.tenantId,
    undefined,
    'Type=="ACCREC"',
    undefined,
    undefined,
    undefined,
    [contactID],
    ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID"],
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    input.reference,
  );
  const existing = found.body.invoices?.find(
    (invoice) => invoice.reference === input.reference && invoice.invoiceID,
  );
  if (existing) return variationInvoiceFieldsFromXero(existing);

  const invoices: Invoices = {
    invoices: [
      {
        contact: { contactID },
        date: format(input.issuedDate, "yyyy-MM-dd"),
        dueDate: format(input.dueDate, "yyyy-MM-dd"),
        // Activity prices are ex GST, so the line is too; Xero adds the GST.
        lineAmountTypes: LineAmountTypes.Exclusive,
        lineItems: [
          {
            accountCode: config.salesAccountCode,
            description: input.lineDescription,
            quantity: 1,
            unitAmount: input.amountExGstCents / 100,
            ...(config.salesTaxType ? { taxType: config.salesTaxType } : {}),
          },
        ],
        reference: input.reference,
        status: Invoice.StatusEnum.AUTHORISED,
        type: Invoice.TypeEnum.ACCREC,
      },
    ],
  };
  const response = await context.xero.accountingApi.createInvoices(
    context.tenantId,
    invoices,
    false,
    undefined,
    `variation-invoice-${input.variationId}`,
  );
  const created = response.body.invoices?.[0];
  if (!created?.invoiceID || created.invoiceID === NO_INVOICE_ID) {
    const reason = created?.validationErrors
      ?.map((error) => error.message)
      .join("; ");
    throw new Error(`Xero rejected the invoice${reason ? `: ${reason}` : "."}`);
  }
  return variationInvoiceFieldsFromXero(created);
}

async function storeVariationDocument(
  input: Parameters<VariationIssuePorts["storeDocument"]>[0],
): Promise<{ url: string }> {
  const pdfBase64 = await generatePDF({
    html: buildVariationDocumentHtml(input.document),
  });
  const blob = await put(
    // Filed under the project, like the stage claims' PDFs. One fixed path
    // per variation, so a second render overwrites rather than orphans.
    `projects/${input.projectId}/variations/${input.variationId}.pdf`,
    Buffer.from(pdfBase64, "base64"),
    {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/pdf",
    },
  );
  return { url: blob.url };
}

export function renderVariationEmailHtml(
  document: VariationDocumentData,
): Promise<string> {
  return render(createElement(VariationInvoiceEmail, { document }));
}

async function sendVariationEmail(
  input: Parameters<VariationIssuePorts["sendEmail"]>[0],
): Promise<void> {
  const pdf = await fetch(input.documentUrl);
  if (!pdf.ok) {
    throw new Error(`the document could not be attached (${pdf.status})`);
  }
  const contentBytes = Buffer.from(await pdf.arrayBuffer()).toString("base64");
  const client = await createGraphContext(getGraphConfig());
  await client.sendMail({
    attachments: [
      {
        contentBytes,
        contentType: "application/pdf",
        name: `Variation-${input.document.number}.pdf`,
      },
    ],
    body: await renderVariationEmailHtml(input.document),
    subject: input.subject,
    to: input.to,
  });
}

export const variationIssuePorts: VariationIssuePorts = {
  raiseInvoice: raiseXeroInvoice,
  sendEmail: sendVariationEmail,
  storeDocument: storeVariationDocument,
};

/** The activity log, the site manager's notification and the cache tags. */
export function afterVariationRaised(
  principal: DomainPrincipal,
  variation: RaisedVariation,
) {
  if (variation.replayed) return;
  after(async () => {
    await logAction(
      {
        ...createActivityLogEntry("variationCreated", {
          projectId: variation.projectId,
          projectName: variation.projectName,
          variationAmount: currency.format(variation.costCents / 100),
          variationDescription: variation.description,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );
    // A variation is priced, and a site manager does not see project money:
    // the project's holder is told only if they work in the office. Never `[]`,
    // which would broadcast.
    const recipients = await filterOfficeUserIds(
      [variation.siteManagerId],
      prisma,
    );
    if (recipients.length === 0) return;
    await triggerNotification(
      recipients,
      createNotification("variationCreated", {
        projectId: variation.projectId,
        projectName: variation.projectName,
        variationAmount: (variation.costCents / 100).toFixed(2),
        variationDescription: variation.description,
      }),
    );
  });
}

/**
 * Bring a variation's invoice in line with Xero, from the invoice webhook.
 * `unknown` means the invoice bills no variation.
 */
export async function syncVariationInvoiceFromXero(
  context: XeroContext,
  xeroInvoiceId: string,
): Promise<VariationInvoiceSyncResult> {
  const result = await syncVariationInvoiceFromExternal(
    xeroInvoiceId,
    prisma,
    async () => {
      const response = await context.xero.accountingApi.getInvoice(
        context.tenantId,
        xeroInvoiceId,
      );
      const invoice = response.body.invoices?.[0];
      return invoice?.invoiceID
        ? variationInvoiceFieldsFromXero(invoice)
        : null;
    },
  );
  if (result.kind === "updated") expireVariationProject(result.projectId);
  return result;
}

/**
 * Approve or reject a variation logged before they were raised approved.
 *
 * `projectId` is required: the route has it in its own URL, and the previous
 * signature took only the variation id, so nothing checked the two matched or
 * that the caller could manage the project.
 */
export async function updateVariationStatus(
  projectId: string,
  variationId: string,
  status: VariationDecision,
) {
  const principal = await currentPrincipal();

  const outcome = await decideVariation(
    principal,
    { decision: status, projectId, variationId },
    prisma,
  );

  after(async () => {
    await logAction(
      {
        ...createActivityLogEntry("variationUpdated", {
          projectId: outcome.projectId,
          projectName: outcome.projectName,
          status: outcome.status,
          variationAmount: currency.format(Number(outcome.cost)),
          variationDescription: outcome.description,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );
    // Same rule as a new variation: the office only, and never `[]`.
    const recipients = await filterOfficeUserIds(
      [outcome.siteManagerId],
      prisma,
    );
    if (recipients.length > 0) {
      await triggerNotification(
        recipients,
        createNotification("variationUpdated", {
          projectId: outcome.projectId,
          projectName: outcome.projectName,
          status: outcome.status,
          variationAmount: outcome.cost,
          variationDescription: outcome.description,
        }),
      );
    }
    revalidateTag(`project-${outcome.projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return outcome;
}
