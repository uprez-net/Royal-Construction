import { revalidateTag } from "next/cache";

import { Prisma, type Invoice as InvoiceRow, type ProjectStage } from "@prisma/client";
import { put } from "@vercel/blob";
import { addDays, format } from "date-fns";
import { Invoice, type Invoices, LineAmountTypes } from "xero-node";

import prisma from "@/lib/prisma";
import { flattenMilestones, stageState } from "@/lib/projects/milestone-ledger";
import { buildMilestoneTree, groupRootsByStage } from "@/lib/projects/milestone-tree";
import { resolveStageClaims } from "@/lib/projects/stage-claim";
import { getXeroContext, XeroNotConnectedError, type XeroContext } from "@/lib/xero/client";
import { getXeroConfig } from "@/lib/xero/config";
import { resolveXeroContactId } from "@/lib/xero/contact";
import { invoiceStatusRank, toInvoiceStatus } from "@/lib/xero/invoice-status";
import { parseXeroDate } from "@/lib/xero/xero-date";
import { CACHE_PROFILES } from "@/types/cache";
import {
  PROJECT_STAGE_LABELS,
  type ProjectListInvoice,
  type SafeInvoice,
} from "@/types/project";
import type { ProjectRequirementsPayload } from "@/types/project-flow";

/** Days the owner has to pay a progress claim. */
const PAYMENT_TERMS_DAYS = 14;

/**
 * Strip Prisma `Decimal`s off an invoice for the RSC boundary.
 *
 * Decimals are class instances and are not serializable, so every money field
 * crosses as a string and the client does its own `Number(...)` — the same
 * contract `getProjectById` already applies to budgets and milestone spend.
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
  projectStage: ProjectStage;
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

/**
 * Raise the progress claim for the stage a milestone belongs to, if that stage
 * is now finished and unclaimed.
 *
 * Takes a milestone rather than a stage because the two are not the same
 * question. A sub-activity may carry a different `projectStage` from the root
 * it hangs off — the template has one, a Lockup activity under a Frame
 * inspection — and the stage it actually completes is its ROOT's, which is how
 * the Milestones tab groups it. Trusting the milestone's own `projectStage`
 * would check a group the milestone is not in and quietly never raise the claim
 * it just finished.
 *
 * Called from `updateMilestone`'s post-response hook, which can fire many times
 * for the same stage — every milestone completion in it, plus any retry — so
 * every exit here is a guard and the whole thing is safe to run repeatedly.
 *
 * Deliberately swallows its errors. Raising a claim is downstream of marking a
 * milestone done; a Xero outage or a lapsed connection must not turn a
 * successful milestone update into a failed request the operator has to retry.
 * The claim is picked up when the next milestone in the stage settles.
 */
export async function ensureStageInvoice(
  projectId: string,
  milestoneId: string,
): Promise<void> {
  try {
    const milestones = await prisma.milestone.findMany({
      where: { projectId },
      select: {
        id: true,
        parentId: true,
        order: true,
        projectStage: true,
        name: true,
        status: true,
        targetDate: true,
        actualDate: true,
      },
    });

    // Group the way the Milestones tab does — roots by stage, whole subtree
    // considered — so the stage the operator sees as complete is exactly the
    // one that gets claimed.
    const grouped = groupRootsByStage(buildMilestoneTree(milestones));

    // Which group actually contains this milestone — its root's stage, which is
    // not always its own.
    let stage: ProjectStage | undefined;
    let stageMilestones: (typeof grouped)[ProjectStage] = [];
    for (const [candidate, candidateMilestones] of Object.entries(grouped)) {
      const contains = flattenMilestones(candidateMilestones ?? []).some(
        (milestone) => milestone.id === milestoneId,
      );
      if (contains) {
        stage = candidate as ProjectStage;
        stageMilestones = candidateMilestones ?? [];
        break;
      }
    }
    if (!stage) {
      return;
    }

    if (stageState(stageMilestones) !== "complete") {
      return;
    }

    // A stage whose every activity was waived was never worked, so there is
    // nothing to claim. `stageState` calls that "complete" — correctly, nothing
    // is outstanding — but completing a stage is not the same as earning it.
    const activities = flattenMilestones(stageMilestones);
    if (activities.every((milestone) => milestone.status === "NOT_REQUIRED")) {
      return;
    }

    // Only ever the stage that just finished. Deliberately not a sweep of every
    // complete-and-unclaimed stage: on a project already part-built when this
    // shipped, that would bill the owner for stages the builder has almost
    // certainly already invoiced by hand.
    const existing = await prisma.invoice.findUnique({
      where: { projectId_projectStage: { projectId, projectStage: stage } },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    await createStageInvoice(projectId, stage);
  } catch (error) {
    if (error instanceof XeroNotConnectedError) {
      console.warn(
        `[xero] Skipped the claim for project ${projectId}: ${error.message}`,
      );
      return;
    }
    console.error(
      `[xero] Failed to raise a stage claim for project ${projectId}:`,
      error,
    );
  }
}

/**
 * Create the Xero invoice for a completed stage and record it.
 *
 * Invoices are raised AUTHORISED rather than DRAFT: Xero will not accept a
 * payment against a draft, so a draft would never produce the payment webhook
 * this whole flow is built around.
 *
 * @throws {XeroNotConnectedError} If no Xero organisation is connected.
 */
export async function createStageInvoice(
  projectId: string,
  projectStage: ProjectStage,
): Promise<InvoiceRow | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { customer: true },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found.`);
  }

  const requirements = project.requirements as ProjectRequirementsPayload | null;
  const claims = resolveStageClaims(
    requirements?.commercialsAndClaims?.paymentStages,
    Number(project.totalBudget),
  );
  const claim = claims[projectStage]?.claim;

  // An unknown claim is not a zero claim. Invoicing the owner for $0 — or for a
  // figure nobody agreed to — is worse than raising nothing and letting someone
  // notice the stage has no claim against it on the Payments tab.
  if (claim == null || !Number.isFinite(claim) || claim <= 0) {
    console.warn(
      `[xero] No claim amount resolved for ${projectStage} on project ${projectId}; nothing invoiced.`,
    );
    return null;
  }

  // An AUTHORISED invoice has to be complete enough to post to the ledger, so
  // Xero requires a revenue account on every line — and without one it cannot
  // derive the tax treatment either, which is why a missing account code shows
  // up as two errors ("Account code or ID must be specified; The TaxType field
  // is mandatory"). A DRAFT would have been accepted without it and failed the
  // moment anyone approved it.
  const config = getXeroConfig();
  if (!config.salesAccountCode) {
    throw new Error(
      "Xero invoicing is not configured — set XERO_SALES_ACCOUNT_CODE to the revenue account progress claims should post to.",
    );
  }

  const context = await getXeroContext();
  const contactID = await resolveXeroContactId(context, project.customer);

  const stageLabel = PROJECT_STAGE_LABELS[projectStage] ?? projectStage;
  const issuedDate = new Date();
  const dueDate = addDays(issuedDate, PAYMENT_TERMS_DAYS);

  const invoices: Invoices = {
    invoices: [
      {
        type: Invoice.TypeEnum.ACCREC,
        contact: { contactID },
        // Xero wants plain calendar dates here; a full ISO timestamp is rejected.
        date: format(issuedDate, "yyyy-MM-dd"),
        dueDate: format(dueDate, "yyyy-MM-dd"),
        reference: `${project.name} / ${stageLabel}`,
        status: Invoice.StatusEnum.AUTHORISED,
        // Whether the contract's figures already carry GST decides how Xero
        // treats the line amount. Getting this backwards moves the total by
        // 10%, on a document the owner is being asked to pay.
        lineAmountTypes: requirements?.commercialsAndClaims?.gstIncluded
          ? LineAmountTypes.Inclusive
          : LineAmountTypes.Exclusive,
        lineItems: [
          {
            description: `${project.name} — ${stageLabel} progress claim`,
            quantity: 1,
            unitAmount: claim,
            accountCode: config.salesAccountCode,
            // Omitted unless overridden, so Xero applies the sales account's
            // own default tax rate — the setting the bookkeeper already chose.
            ...(config.salesTaxType ? { taxType: config.salesTaxType } : {}),
          },
        ],
      },
    ],
  };

  const response = await context.xero.accountingApi.createInvoices(
    context.tenantId,
    invoices,
    // `summarizeErrors: false` — Xero answers 200 with the rejection recorded on
    // the invoice rather than failing the request with an opaque 400.
    false,
    undefined,
    // Xero's own duplicate guard, keyed the same way our unique index is. Two
    // concurrent hook runs that both get past the existence check still leave
    // one invoice in Xero rather than billing the owner twice.
    `stage-invoice-${projectId}-${projectStage}`,
  );

  const created = response.body.invoices?.[0];
  if (!created?.invoiceID || created.invoiceID === "00000000-0000-0000-0000-000000000000") {
    const reason = created?.validationErrors?.map((e) => e.message).join("; ");
    throw new Error(
      `Xero rejected the ${stageLabel} claim for project ${projectId}${reason ? `: ${reason}` : "."}`,
    );
  }

  let row: InvoiceRow;
  try {
    row = await prisma.invoice.create({
      data: {
        projectId,
        projectStage,
        ...invoiceFieldsFromXero(created),
        xeroInvoiceId: created.invoiceID,
      },
    });
  } catch (error) {
    // P2002 on (projectId, projectStage): another run claimed this stage while
    // we were talking to Xero. The idempotency key means Xero handed back that
    // same invoice, so the existing row is the right answer, not an error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.invoice.findUnique({
        where: { projectId_projectStage: { projectId, projectStage } },
      });
    }
    // The claim now exists in Xero but not here. Name it in the log: the id is
    // what anyone reconciling by hand needs, and the generic handler upstream
    // does not have it.
    console.error(
      `[xero] Invoice ${created.invoiceID} was raised in Xero but could not be recorded for project ${projectId} / ${projectStage}:`,
      error,
    );
    throw error;
  }

  // The PDF is a convenience, not the claim. Archiving after the row is
  // committed means a blob failure costs a link we can re-fetch, rather than
  // losing an invoice that already exists in Xero and would be raised again.
  await archiveInvoicePdf(context, row.id, created.invoiceID, projectId);

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return row;
}

/**
 * Bring one invoice back in line with Xero. Driven by the webhook, whose
 * payload carries only a resource id — the amounts have to be fetched.
 */
export async function syncInvoiceFromXero(xeroInvoiceId: string): Promise<void> {
  const existing = await prisma.invoice.findUnique({
    where: { xeroInvoiceId },
    select: {
      id: true,
      projectId: true,
      status: true,
      xeroUpdatedAt: true,
      pdfUrl: true,
    },
  });
  // Not one of ours. The webhook fires for every invoice in the organisation,
  // and invoices the bookkeeper raised by hand are none of our business.
  if (!existing) {
    return;
  }

  const context = await getXeroContext();
  const response = await context.xero.accountingApi.getInvoice(
    context.tenantId,
    xeroInvoiceId,
  );
  const invoice = response.body.invoices?.[0];
  if (!invoice) {
    return;
  }

  const fields = invoiceFieldsFromXero(invoice);

  // Forward-only, on two independent axes. Xero's `updatedDateUTC` rejects a
  // stale delivery outright; the status rank additionally refuses to walk a
  // status backwards, which covers a replay carrying the same timestamp.
  if (
    existing.xeroUpdatedAt &&
    fields.xeroUpdatedAt &&
    fields.xeroUpdatedAt <= existing.xeroUpdatedAt
  ) {
    return;
  }
  if (invoiceStatusRank(fields.status) < invoiceStatusRank(existing.status)) {
    return;
  }

  await prisma.invoice.update({ where: { id: existing.id }, data: fields });

  // An invoice that had no PDF when it was created — an archive failure, or a
  // claim that was still a draft — gets one now.
  if (!existing.pdfUrl) {
    await archiveInvoicePdf(context, existing.id, xeroInvoiceId, existing.projectId);
  }

  revalidateTag(`project-${existing.projectId}`, CACHE_PROFILES.MEDIUM);
}

/** Download the rendered invoice from Xero and park it in our own blob store. */
async function archiveInvoicePdf(
  context: XeroContext,
  invoiceId: string,
  xeroInvoiceId: string,
  projectId: string,
): Promise<void> {
  try {
    const pdf = await context.xero.accountingApi.getInvoiceAsPdf(
      context.tenantId,
      xeroInvoiceId,
    );

    const blob = await put(
      // Filed under the project, like every other file on the job, so the blob
      // store stays navigable. No `File` row to go with it: `File.uploadedBy`
      // is a required FK to a User and nobody uploaded this.
      `projects/${projectId}/invoices/${xeroInvoiceId}.pdf`,
      pdf.body,
      {
        access: "public",
        // The Xero invoice id already makes the path unique.
        addRandomSuffix: false,
        // Re-archiving after the invoice changed overwrites in place rather
        // than orphaning the previous object.
        allowOverwrite: true,
        contentType: "application/pdf",
      },
    );

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl: blob.url },
    });
  } catch (error) {
    // Best effort: Xero holds the document and it can be fetched again on the
    // next webhook. Losing our copy must not lose the claim.
    console.error(`[xero] Failed to archive the PDF for invoice ${xeroInvoiceId}:`, error);
  }
}

/** The fields we mirror off a Xero invoice, shaped for a Prisma write. */
function invoiceFieldsFromXero(invoice: Invoice) {
  return {
    invoiceNumber: invoice.invoiceNumber ?? null,
    reference: invoice.reference ?? null,
    status: toInvoiceStatus(invoice.status) ?? "DRAFT",
    currencyCode: invoice.currencyCode ? String(invoice.currencyCode) : "AUD",
    subTotal: decimal(invoice.subTotal),
    totalTax: decimal(invoice.totalTax),
    total: decimal(invoice.total),
    amountDue: decimal(invoice.amountDue),
    amountPaid: decimal(invoice.amountPaid),
    amountCredited: decimal(invoice.amountCredited),
    issuedDate: parseXeroDate(invoice.date) ?? new Date(),
    dueDate: parseXeroDate(invoice.dueDate) ?? new Date(),
    fullyPaidOnDate: parseXeroDate(invoice.fullyPaidOnDate),
    xeroUpdatedAt: parseXeroDate(invoice.updatedDateUTC),
  } as const;
}

/** A money field as a Decimal, treating a missing figure as zero rather than null. */
function decimal(value: number | undefined): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(value) ? (value as number) : 0);
}
