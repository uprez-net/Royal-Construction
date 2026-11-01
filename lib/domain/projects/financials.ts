import type { DomainDb } from "../db";
import { authorizeProject } from "../access/projects";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { bookingPrice, toCents } from "../tradies/billing-rules";
import { bookingTrade } from "../tradies/request-rules";

import {
  buildProjectFinancialReport,
  type ProjectFinancialReport,
} from "./financial-report";

export type ProjectFinancials = ProjectFinancialReport & {
  readonly projectId: string;
};

/**
 * The project's profit and loss, for the Financials tab.
 *
 * Admin only, like the Payments tab: it puts the tender beside what each
 * tradie is paid, which is the margin. Read fresh on every request rather than
 * cached — a booking's price, status and invoices change from the Tradies tab,
 * Eve, the email-reply webhook and the Xero webhook, and a stale margin is the
 * kind of wrong number nobody notices until it matters.
 */
export async function getProjectFinancials(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<ProjectFinancials> {
  requireAdminPrincipal(principal);
  const project = await authorizeProject(principal, input.projectId, db);

  const [milestones, schedules, invoices, variations] = await Promise.all([
    db.milestone.findMany({
      select: {
        budget: true,
        id: true,
        name: true,
        order: true,
        parentId: true,
        projectStage: true,
        status: true,
      },
      where: { projectId: project.id },
    }),
    db.tradieSchedule.findMany({
      select: {
        durationDays: true,
        id: true,
        milestoneId: true,
        quote: { select: { gstTreatment: true } },
        quotedPrice: true,
        requiresQuote: true,
        scheduledDate: true,
        status: true,
        trade: true,
        tradie: {
          select: {
            id: true,
            lastQuotedPrice: true,
            lastQuotedPriceUnit: true,
            name: true,
            trade: true,
          },
        },
      },
      where: { projectId: project.id },
    }),
    db.tradieInvoice.findMany({
      select: {
        amountPaid: true,
        documentName: true,
        documentUrl: true,
        dueDate: true,
        id: true,
        invoiceNumber: true,
        issuedDate: true,
        notes: true,
        reference: true,
        scheduleId: true,
        source: true,
        status: true,
        subTotal: true,
        total: true,
        totalTax: true,
        tradie: { select: { id: true, name: true } },
      },
      where: { projectId: project.id },
    }),
    db.variation.findMany({
      select: { cost: true, kind: true, milestoneId: true, status: true },
      where: { projectId: project.id },
    }),
  ]);

  const report = buildProjectFinancialReport({
    bookings: schedules.map((schedule) => ({
      id: schedule.id,
      milestoneId: schedule.milestoneId,
      price: bookingPrice({
        durationDays: schedule.durationDays,
        quoteGst: schedule.quote?.gstTreatment ?? null,
        quotedPrice: schedule.quotedPrice,
        requiresQuote: schedule.requiresQuote,
        status: schedule.status,
        tradie: {
          lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString() ?? null,
          lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
        },
      }),
      scheduledDate: schedule.scheduledDate.toISOString(),
      status: schedule.status,
      trade: bookingTrade(schedule),
      tradieId: schedule.tradie.id,
      tradieName: schedule.tradie.name,
    })),
    invoices: invoices.map((invoice) => ({
      amountPaidCents: toCents(invoice.amountPaid),
      documentName: invoice.documentName,
      documentUrl: invoice.documentUrl,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issuedDate: invoice.issuedDate.toISOString(),
      notes: invoice.notes,
      reference: invoice.reference,
      scheduleId: invoice.scheduleId,
      source: invoice.source,
      status: invoice.status,
      subTotalCents: toCents(invoice.subTotal),
      totalCents: toCents(invoice.total),
      totalTaxCents: toCents(invoice.totalTax),
      tradieId: invoice.tradie.id,
      tradieName: invoice.tradie.name,
    })),
    milestones: milestones.map((milestone) => ({
      budgetCents: toCents(milestone.budget),
      id: milestone.id,
      name: milestone.name,
      order: milestone.order,
      parentId: milestone.parentId,
      projectStage: milestone.projectStage,
      status: milestone.status,
    })),
    variations: variations.map((variation) => ({
      costCents: toCents(variation.cost),
      kind: variation.kind,
      milestoneId: variation.milestoneId,
      status: variation.status,
    })),
  });

  return { ...report, projectId: project.id };
}
