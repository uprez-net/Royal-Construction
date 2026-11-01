import assert from "node:assert/strict";
import {
  InvoiceStatus,
  MilestoneStatus,
  ProjectStage,
  TradieInvoiceSource,
  TradieQuoteGst,
  TradieScheduleStatus,
} from "@prisma/client";
import { describe, test } from "vitest";

import {
  buildProjectFinancialReport,
  type ReportBooking,
  type ReportInvoice,
  type ReportMilestone,
} from "@/lib/domain/projects/financial-report";
import {
  bookingBillingState,
  bookingPrice,
  toCents,
} from "@/lib/domain/tradies/billing-rules";
import { tradieScheduleSpend } from "@/lib/domain/tradies/lifecycle";

// Issue #405: A is the tender, B the committed tradie price, C what was
// invoiced; P/L is A − C. Every figure is decided in the pure report, so these
// pin the arithmetic the Financials tab shows a person deciding what to pay.

const milestone = (
  overrides: Partial<ReportMilestone> & { id: string },
): ReportMilestone => ({
  budgetCents: 0,
  name: overrides.id,
  order: 1,
  parentId: null,
  projectStage: ProjectStage.Frame,
  status: MilestoneStatus.PENDING,
  ...overrides,
});

const booking = (
  overrides: Partial<ReportBooking> & {
    id: string;
    milestoneId: string | null;
  },
): ReportBooking => ({
  price: { basis: "QUOTE", exGstCents: 0, gstStated: true },
  scheduledDate: "2026-11-02T00:00:00.000Z",
  status: TradieScheduleStatus.CONFIRMED,
  trade: "Carpentry",
  tradieId: "tradie-1",
  tradieName: "Ace Carpentry",
  ...overrides,
});

let invoiceCount = 0;
const invoice = (
  overrides: Partial<ReportInvoice> & { scheduleId: string | null },
): ReportInvoice => ({
  amountPaidCents: 0,
  documentName: null,
  documentUrl: null,
  dueDate: null,
  id: `invoice-${++invoiceCount}`,
  invoiceNumber: `INV-${invoiceCount}`,
  issuedDate: "2026-11-10T00:00:00.000Z",
  notes: null,
  reference: null,
  source: TradieInvoiceSource.MANUAL,
  status: InvoiceStatus.AUTHORISED,
  subTotalCents: 0,
  totalCents: 0,
  totalTaxCents: 0,
  tradieId: "tradie-1",
  tradieName: "Ace Carpentry",
  ...overrides,
});

const priced = (exGstCents: number) =>
  ({ basis: "QUOTE", exGstCents, gstStated: true }) as const;

describe("activity profit and loss", () => {
  test("A − C with its percentage of A, as the issue writes it", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(400_00) }),
      ],
      invoices: [invoice({ scheduleId: "b1", subTotalCents: 349_00 })],
      milestones: [milestone({ budgetCents: 500_00, id: "m1" })],
    });
    const figures = report.stages[0].activities[0].figures;
    assert.equal(figures.tenderCents, 500_00);
    assert.equal(figures.quotedCents, 400_00);
    assert.equal(figures.invoicedCents, 349_00);
    assert.equal(figures.profitCents, 151_00);
    assert.equal(figures.profitPercent, 30.2);
    assert.equal(figures.outcome, "PROFIT");
    // Still billing up to the quote: the forecast takes the larger of B and C.
    assert.equal(figures.forecastProfitCents, 100_00);
  });

  test("a loss is negative, and the over-invoiced warning fires on C > B", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(1_000_00) }),
      ],
      invoices: [
        invoice({ scheduleId: "b1", subTotalCents: 700_00 }),
        invoice({ scheduleId: "b1", subTotalCents: 500_00 }),
      ],
      milestones: [milestone({ budgetCents: 1_200_00 - 100_00, id: "m1" })],
    });
    const { figures, bookings } = report.stages[0].activities[0];
    assert.equal(figures.invoicedCents, 1_200_00);
    assert.equal(figures.profitCents, -100_00);
    assert.equal(figures.profitPercent, -9.1);
    assert.equal(figures.outcome, "LOSS");
    assert.equal(figures.overInvoiced, true);
    assert.equal(bookings[0].billing, "OVER_INVOICED");
  });

  test("nothing invoiced is not profit, whatever the tender", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(800_00) }),
      ],
      invoices: [],
      milestones: [milestone({ budgetCents: 1_000_00, id: "m1" })],
    });
    const { figures } = report.stages[0].activities[0];
    assert.equal(figures.outcome, "NOT_INVOICED");
    assert.equal(figures.profitCents, null);
    assert.equal(figures.profitPercent, null);
    assert.equal(figures.forecastProfitCents, 200_00);
  });

  test("no tender gives no percentage rather than a division by zero", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(100_00) }),
      ],
      invoices: [invoice({ scheduleId: "b1", subTotalCents: 100_00 })],
      milestones: [milestone({ budgetCents: 0, id: "m1" })],
    });
    const { figures } = report.stages[0].activities[0];
    assert.equal(figures.profitCents, -100_00);
    assert.equal(figures.profitPercent, null);
    assert.equal(figures.outcome, "LOSS");
  });

  test("voided invoices are shown but not counted", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(500_00) }),
      ],
      invoices: [
        invoice({ scheduleId: "b1", subTotalCents: 500_00 }),
        invoice({
          scheduleId: "b1",
          status: InvoiceStatus.VOIDED,
          subTotalCents: 500_00,
        }),
      ],
      milestones: [milestone({ budgetCents: 500_00, id: "m1" })],
    });
    const { figures, bookings } = report.stages[0].activities[0];
    assert.equal(figures.invoicedCents, 500_00);
    assert.equal(figures.outcome, "EVEN");
    assert.equal(bookings[0].invoices.length, 2);
    assert.equal(bookings[0].billing, "INVOICED");
  });

  test("an uncommitted quote is not B, and is not shown unless it was billed", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({
          id: "quote-only",
          milestoneId: "m1",
          price: priced(900_00),
          status: TradieScheduleStatus.QUOTE_RECEIVED,
        }),
        booking({
          id: "cancelled-but-billed",
          milestoneId: "m1",
          price: priced(300_00),
          status: TradieScheduleStatus.CANCELLED,
        }),
      ],
      invoices: [
        invoice({ scheduleId: "cancelled-but-billed", subTotalCents: 50_00 }),
      ],
      milestones: [milestone({ budgetCents: 1_000_00, id: "m1" })],
    });
    const { figures, bookings } = report.stages[0].activities[0];
    assert.deepEqual(
      bookings.map((row) => row.id),
      ["cancelled-but-billed"],
    );
    assert.equal(figures.quotedCents, 0);
    assert.equal(figures.invoicedCents, 50_00);
    assert.equal(bookings[0].billing, "INVOICED_UNPRICED");
  });

  test("a committed booking with no price flags B as incomplete and holds back the C > B warning", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "m1", price: priced(100_00) }),
        booking({
          id: "b2",
          milestoneId: "m1",
          price: { basis: "NONE", exGstCents: 0, gstStated: true },
        }),
      ],
      invoices: [invoice({ scheduleId: "b2", subTotalCents: 250_00 })],
      milestones: [milestone({ budgetCents: 1_000_00, id: "m1" })],
    });
    const { figures } = report.stages[0].activities[0];
    assert.equal(figures.quoteMissing, true);
    assert.equal(figures.overInvoiced, false);
  });
});

describe("consolidation", () => {
  test("a parent's own tender is what its budget leaves after its children, and its figures roll them up", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({
          id: "b-parent",
          milestoneId: "parent",
          price: priced(50_00),
        }),
        booking({ id: "b-child", milestoneId: "child", price: priced(300_00) }),
      ],
      invoices: [invoice({ scheduleId: "b-child", subTotalCents: 320_00 })],
      milestones: [
        // The handoff rolled the child's 400 into the parent's 500.
        milestone({ budgetCents: 500_00, id: "parent", order: 1 }),
        milestone({
          budgetCents: 400_00,
          id: "child",
          order: 2,
          parentId: "parent",
        }),
      ],
    });
    const [parent] = report.stages[0].activities;
    assert.equal(parent.own.tenderCents, 100_00);
    assert.equal(parent.figures.tenderCents, 500_00);
    assert.equal(parent.figures.quotedCents, 350_00);
    assert.equal(parent.figures.invoicedCents, 320_00);
    assert.equal(parent.figures.overInvoiced, true);
    assert.equal(parent.children[0].figures.profitCents, 80_00);
    // The stage counts the parent once, not the parent and its child.
    assert.equal(report.stages[0].figures.tenderCents, 500_00);
  });

  test("a child added after the handoff is not subtracted below zero", () => {
    const report = buildProjectFinancialReport({
      bookings: [],
      invoices: [],
      milestones: [
        milestone({ budgetCents: 100_00, id: "parent", order: 1 }),
        milestone({
          budgetCents: 250_00,
          id: "late-child",
          order: 2,
          parentId: "parent",
        }),
      ],
    });
    const [parent] = report.stages[0].activities;
    assert.equal(parent.own.tenderCents, 0);
    assert.equal(parent.figures.tenderCents, 250_00);
  });

  test("a child tagged with another stage stays under its parent's stage", () => {
    const report = buildProjectFinancialReport({
      bookings: [],
      invoices: [],
      milestones: [
        milestone({ id: "frame", order: 1, projectStage: ProjectStage.Frame }),
        milestone({
          id: "termites",
          order: 2,
          parentId: "frame",
          projectStage: ProjectStage.Lockup,
        }),
      ],
    });
    assert.deepEqual(
      report.stages.map((stage) => stage.stage),
      [ProjectStage.Frame],
    );
  });
});

describe("project totals", () => {
  test("profit to date counts only invoiced activities, plus costs with no tender", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({ id: "b1", milestoneId: "invoiced", price: priced(400_00) }),
        booking({ id: "b2", milestoneId: "not-yet", price: priced(600_00) }),
        booking({ id: "b3", milestoneId: null, price: priced(0) }),
      ],
      invoices: [
        invoice({ scheduleId: "b1", subTotalCents: 400_00 }),
        invoice({ scheduleId: "b3", subTotalCents: 20_00 }),
        invoice({
          scheduleId: null,
          subTotalCents: 30_00,
          tradieId: "tradie-2",
        }),
      ],
      milestones: [
        milestone({ budgetCents: 500_00, id: "invoiced", order: 1 }),
        milestone({ budgetCents: 1_000_00, id: "not-yet", order: 2 }),
      ],
    });
    const { totals } = report;
    assert.equal(totals.tenderCents, 1_500_00);
    assert.equal(totals.invoicedCents, 450_00);
    assert.equal(totals.unallocatedCents, 30_00);
    // 500 − 400 on the invoiced activity, less the 20 and 30 with no tender.
    assert.equal(totals.profitCents, 50_00);
    assert.equal(totals.profitPercent, 10);
    // 1,500 less 400 + 600 + 20 + 30.
    assert.equal(totals.forecastProfitCents, 450_00);
    assert.equal(report.unassigned.bookings.length, 1);
    assert.equal(report.unallocatedInvoices.length, 1);
  });
});

describe("profit to date under a parent", () => {
  test("an uninvoiced child's tender is not profit because its sibling was invoiced", () => {
    const report = buildProjectFinancialReport({
      bookings: [
        booking({
          id: "b-billed",
          milestoneId: "billed",
          price: priced(300_00),
        }),
        booking({ id: "b-open", milestoneId: "open", price: priced(500_00) }),
      ],
      invoices: [invoice({ scheduleId: "b-billed", subTotalCents: 300_00 })],
      milestones: [
        milestone({ budgetCents: 1_000_00, id: "parent", order: 1 }),
        milestone({
          budgetCents: 400_00,
          id: "billed",
          order: 2,
          parentId: "parent",
        }),
        milestone({
          budgetCents: 600_00,
          id: "open",
          order: 3,
          parentId: "parent",
        }),
      ],
    });
    // Only the invoiced child: 400 − 300. The other child's 600 is not in it.
    assert.equal(report.totals.profitCents, 100_00);
    assert.equal(report.totals.profitPercent, 25);
  });
});

describe("booking price and billing state", () => {
  test("a GST-inclusive quote is brought back to ex GST", () => {
    const price = bookingPrice({
      durationDays: 1,
      quoteGst: TradieQuoteGst.INCLUSIVE,
      quotedPrice: "1100.00",
      requiresQuote: true,
      status: TradieScheduleStatus.CONFIRMED,
      tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" },
    });
    assert.deepEqual(price, {
      basis: "QUOTE",
      exGstCents: 1_000_00,
      gstStated: true,
    });
  });

  test("a quote silent on GST is read as ex GST and says so", () => {
    const price = bookingPrice({
      durationDays: 1,
      quoteGst: null,
      quotedPrice: "1100.00",
      requiresQuote: true,
      status: TradieScheduleStatus.CONFIRMED,
      tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" },
    });
    assert.equal(price.exGstCents, 1_100_00);
    assert.equal(price.gstStated, false);
  });

  test("a price written before quotes were normalised still reads", () => {
    const schedule = {
      durationDays: 1,
      requiresQuote: true,
      status: TradieScheduleStatus.CONFIRMED,
      tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" as const },
    };
    assert.equal(
      tradieScheduleSpend({ ...schedule, quotedPrice: "$4,500" }),
      4500,
    );
    assert.equal(
      tradieScheduleSpend({ ...schedule, quotedPrice: "1,200.00" }),
      1200,
    );
  });

  test("billing states", () => {
    assert.equal(
      bookingBillingState({ agreedCents: 100, invoicedCents: 0 }),
      "NOT_INVOICED",
    );
    assert.equal(
      bookingBillingState({ agreedCents: 100, invoicedCents: 40 }),
      "PART_INVOICED",
    );
    assert.equal(
      bookingBillingState({ agreedCents: 100, invoicedCents: 100 }),
      "INVOICED",
    );
    assert.equal(
      bookingBillingState({ agreedCents: 100, invoicedCents: 101 }),
      "OVER_INVOICED",
    );
    assert.equal(
      bookingBillingState({ agreedCents: 0, invoicedCents: 5 }),
      "INVOICED_UNPRICED",
    );
  });

  test("cents round to the cent", () => {
    assert.equal(toCents("1234.565"), 123457);
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(toCents("not money"), 0);
  });
});

describe("variations", () => {
  test("a chargeable variation raises the quoted price; a promotional one does not", () => {
    // The promotional cost is already in what the tradie invoiced, so taking
    // it off the quoted price as well would count it against profit twice.
    const report = buildProjectFinancialReport({
      bookings: [],
      invoices: [],
      milestones: [milestone({ budgetCents: 1_000_000, id: "roof" })],
      variations: [
        {
          costCents: 250_000,
          kind: "CHARGEABLE",
          milestoneId: "roof",
          status: "APPROVED",
        },
        {
          costCents: 80_000,
          kind: "PROMOTIONAL",
          milestoneId: "roof",
          status: "APPROVED",
        },
        {
          costCents: 999_999,
          kind: "CHARGEABLE",
          milestoneId: "roof",
          status: "REJECTED",
        },
      ],
    });
    const [roof] = report.stages[0].activities;
    assert.equal(roof.figures.tenderCents, 1_250_000);
    assert.equal(roof.variationCents, 250_000);
    assert.equal(report.totals.tenderCents, 1_250_000);
    assert.equal(report.totals.chargeableVariationCents, 250_000);
    assert.equal(report.totals.promotionalVariationCents, 80_000);
  });
});
