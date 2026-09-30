import { revalidateTag } from "next/cache";

import {
  Prisma,
  type Invoice as InvoiceRow,
  type ProjectStage,
} from "@prisma/client";
import { put } from "@vercel/blob";
import { format } from "date-fns";
import { Invoice, type Invoices, LineAmountTypes } from "xero-node";

import prisma from "@/lib/prisma";
import { flattenMilestones, stageState } from "@/lib/projects/milestone-ledger";
import {
  buildMilestoneTree,
  groupRootsByStage,
} from "@/lib/projects/milestone-tree";
import {
  getXeroContext,
  XeroNotConnectedError,
  type XeroContext,
} from "@/lib/xero/client";
import { getXeroConfig } from "@/lib/xero/config";
import { resolveProjectXeroContactId } from "@/lib/xero/contact";
import { toInvoiceStatus } from "@/lib/xero/invoice-status";
import { parseXeroDate } from "@/lib/xero/xero-date";
import {
  archiveInvoicePdf as archiveInvoicePdfDurably,
  syncInvoiceFromExternal,
} from "@/lib/domain/invoices/sync";
import { createStageInvoice as createStageInvoiceDomain } from "@/lib/domain/invoices/stage-creation";
import { CACHE_PROFILES } from "@/types/cache";
import { PROJECT_STAGE_LABELS } from "@/types/project";

/** Days the owner has to pay a progress claim. */
// The two pure serializers moved to `lib/domain/invoices/serialize.ts` in
// phase 4 so the project queries could reach them without pulling `xero-node`
// and `@vercel/blob` into the domain layer. Re-exported here because every
// existing caller imports them from this module.
export {
  serializeInvoice,
  serializeListInvoice,
} from "@/lib/domain/invoices/serialize";

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
  const stageLabel = PROJECT_STAGE_LABELS[projectStage] ?? projectStage;
  const issuedDate = new Date();
  let context: XeroContext | null = null;

  const row = await createStageInvoiceDomain(
    {
      issuedDate,
      projectId,
      projectStage,
      stageLabel,
    },
    prisma,
    async ({ claim, dueDate, gstIncluded, project }) => {
      // An AUTHORISED invoice has to be complete enough to post to the ledger,
      // so Xero requires a revenue account on every line. Resolve provider
      // configuration only after the domain has confirmed there is a claim;
      // an unconfigured Xero connection must not turn a no-op stage into an
      // error.
      const config = getXeroConfig();
      if (!config.salesAccountCode) {
        throw new Error(
          "Xero invoicing is not configured — set XERO_SALES_ACCOUNT_CODE to the revenue account progress claims should post to.",
        );
      }
      const salesAccountCode = config.salesAccountCode;
      context = await getXeroContext();
      // The project's own contact: every owner on the contract, reached
      // through the primary (lib/domain/projects/billing-contact.ts).
      const contactID = await resolveProjectXeroContactId(context, project.id);
      const invoices: Invoices = {
        invoices: [
          {
            type: Invoice.TypeEnum.ACCREC,
            contact: { contactID },
            date: format(issuedDate, "yyyy-MM-dd"),
            dueDate: format(dueDate, "yyyy-MM-dd"),
            reference: `${project.name} / ${stageLabel}`,
            status: Invoice.StatusEnum.AUTHORISED,
            lineAmountTypes: gstIncluded
              ? LineAmountTypes.Inclusive
              : LineAmountTypes.Exclusive,
            lineItems: [
              {
                description: `${project.name} — ${stageLabel} progress claim`,
                quantity: 1,
                unitAmount: claim,
                accountCode: salesAccountCode,
                ...(config.salesTaxType
                  ? { taxType: config.salesTaxType }
                  : {}),
              },
            ],
          },
        ],
      };
      const response = await context.xero.accountingApi.createInvoices(
        context.tenantId,
        invoices,
        false,
        undefined,
        `stage-invoice-${projectId}-${projectStage}`,
      );
      const created = response.body.invoices?.[0];
      if (
        !created?.invoiceID
        || created.invoiceID === "00000000-0000-0000-0000-000000000000"
      ) {
        const reason = created?.validationErrors
          ?.map((error) => error.message)
          .join("; ");
        throw new Error(
          `Xero rejected the ${stageLabel} claim for project ${projectId}${reason ? `: ${reason}` : "."}`,
        );
      }
      return {
        fields: invoiceFieldsFromXero(created),
        xeroInvoiceId: created.invoiceID,
      };
    },
  );

  if (!row) {
    console.warn(
      `[xero] No claim amount resolved for ${projectStage} on project ${projectId}; nothing invoiced.`,
    );
    return null;
  }

  if (!context) {
    throw new Error("Xero invoice context was not created.");
  }

  // The PDF is a convenience, not the claim. Archiving after the row is
  // committed means a blob failure costs a link we can re-fetch, rather than
  // losing an invoice that already exists in Xero and would be raised again.
  await archiveInvoicePdf(context, row.id, row.xeroInvoiceId, projectId);

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return row;
}

/**
 * Bring one invoice back in line with Xero. Driven by the webhook, whose
 * payload carries only a resource id — the amounts have to be fetched.
 */
export async function syncInvoiceFromXero(
  xeroInvoiceId: string,
): Promise<void> {
  const context = await getXeroContext();
  const result = await syncInvoiceFromExternal(
    xeroInvoiceId,
    prisma,
    async ({ projectId }) => {
      const response = await context.xero.accountingApi.getInvoice(
        context.tenantId,
        xeroInvoiceId,
      );
      const invoice = response.body.invoices?.[0];
      if (!invoice) return null;
      return {
        fields: invoiceFieldsFromXero(invoice),
        archivePdf: () =>
          archiveInvoicePdfToBlob(context, xeroInvoiceId, projectId),
      };
    },
  );

  if (result.kind === "updated") {
    const invoice = await prisma.invoice.findUnique({
      select: { projectId: true },
      where: { id: result.invoiceId },
    });
    if (invoice) {
      revalidateTag(`project-${invoice.projectId}`, CACHE_PROFILES.MEDIUM);
    }
  }
}

/**
 * Download the rendered invoice from Xero and park it in our own blob store.
 *
 * Both the creation path and the webhook sync archive through the one domain
 * command, so a PDF that was already archived by whichever arrived first is
 * not fetched and stored a second time.
 */
async function archiveInvoicePdf(
  context: XeroContext,
  invoiceId: string,
  xeroInvoiceId: string,
  projectId: string,
): Promise<void> {
  await archiveInvoicePdfDurably(invoiceId, xeroInvoiceId, prisma, () =>
    archiveInvoicePdfToBlob(context, xeroInvoiceId, projectId),
  );
}

/** Xero/Blob adapter used by both initial creation and webhook sync. */
async function archiveInvoicePdfToBlob(
  context: XeroContext,
  xeroInvoiceId: string,
  projectId: string,
): Promise<string | null> {
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

    return blob.url;
  } catch (error) {
    // Best effort: Xero holds the document and it can be fetched again on the
    // next webhook. Losing our copy must not lose the claim.
    console.error(
      `[xero] Failed to archive the PDF for invoice ${xeroInvoiceId}:`,
      error,
    );
    return null;
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
