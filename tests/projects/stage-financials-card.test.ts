import assert from "node:assert/strict";
import {
  InvoiceStatus,
  MilestoneStatus,
  ProjectStage,
  TradieInvoiceSource,
  TradieScheduleStatus,
} from "@prisma/client";
import type { ExpandedState } from "@tanstack/react-table";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";

import { StageFinancialsCard } from "@/components/projects/detail/financials-tab/stage-financials-card";
import {
  buildProjectFinancialReport,
  type FinancialStage,
} from "@/lib/domain/projects/financial-report";
import {
  NO_FINANCIAL_FILTER,
  type FinancialFilter,
} from "@/lib/projects/financial-filters";

// The stage card is the Financials tab's TanStack Table (v9): sub-activities
// as sub-rows, a detail row per opened activity, and the tab's filter as the
// table's global filter. Rendered for real, because those three are wiring a
// type check cannot see working.

const report = buildProjectFinancialReport({
  bookings: [
    {
      id: "b-roof",
      milestoneId: "roof",
      price: { basis: "QUOTE", exGstCents: 100_00, gstStated: true },
      scheduledDate: "2026-11-02T00:00:00.000Z",
      status: TradieScheduleStatus.CONFIRMED,
      trade: "Roofing",
      tradieId: "roofer",
      tradieName: "Top Roofing",
    },
  ],
  invoices: [
    {
      amountPaidCents: 0,
      documentName: null,
      documentUrl: null,
      dueDate: null,
      id: "i1",
      invoiceNumber: "TR-77",
      issuedDate: "2026-11-10T00:00:00.000Z",
      notes: null,
      reference: null,
      scheduleId: "b-roof",
      source: TradieInvoiceSource.MANUAL,
      status: InvoiceStatus.AUTHORISED,
      subTotalCents: 300_00,
      totalCents: 330_00,
      totalTaxCents: 30_00,
      tradieId: "roofer",
      tradieName: "Top Roofing",
    },
  ],
  milestones: [
    {
      budgetCents: 500_00,
      id: "lockup",
      name: "Lock-up works",
      order: 1,
      parentId: null,
      projectStage: ProjectStage.Lockup,
      status: MilestoneStatus.PENDING,
    },
    {
      budgetCents: 200_00,
      id: "roof",
      name: "Roof sheeting",
      order: 2,
      parentId: "lockup",
      projectStage: ProjectStage.Lockup,
      status: MilestoneStatus.PENDING,
    },
    {
      budgetCents: 300_00,
      id: "windows",
      name: "Windows",
      order: 3,
      parentId: "lockup",
      projectStage: ProjectStage.Lockup,
      status: MilestoneStatus.PENDING,
    },
  ],
});

const noop = () => {};

function render(
  expanded: ExpandedState,
  filter: FinancialFilter | undefined = undefined,
  stage: FinancialStage = report.stages[0],
) {
  return renderToStaticMarkup(
    createElement(StageFinancialsCard, {
      actions: {
        onPrice: async () => true,
        onRecheck: noop,
        onRecord: noop,
        onVariation: noop,
        onVoid: noop,
      },
      expanded,
      filter,
      onExpandedChange: noop,
      onOpenChange: noop,
      open: true,
      stage,
    }),
  );
}

describe("StageFinancialsCard", () => {
  test("collapsed, a parent shows its consolidated figures and hides its children", () => {
    const html = render({});
    assert.match(html, /Lock-up works/);
    assert.match(html, /2 sub-activities · consolidated/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /Roof sheeting/);
    // A 500, B 100, C 300 → +$200.00 40.0% Profit for the parent.
    assert.match(html, /\+\$200\.00/);
    assert.match(html, /40\.0%/);
  });

  test("expanded, children and their bookings and invoices appear", () => {
    const html = render(true);
    assert.match(html, /Roof sheeting/);
    assert.match(html, /Windows/);
    assert.match(html, /Top Roofing/);
    assert.match(html, /TR-77/);
    assert.match(html, /Invoiced exceeds quoted/);
    // The over-invoiced booking offers both follow-ups, and a variation can
    // be raised on the activity it is booked against.
    assert.match(html, /Request recheck/);
    assert.match(
      html,
      /<button(?![^>]*disabled="")[^>]*>(?:(?!<\/button>)[\s\S])*Raise variation/,
    );
    // The roof lost money: −$100.00 on a $200.00 tender.
    assert.match(html, /−\$100\.00/);
  });

  test("the tab's filter is the table's: a loss keeps the parent and hides the profitable sibling", () => {
    const html = render(true, { ...NO_FINANCIAL_FILTER, view: "loss" });
    assert.match(html, /Lock-up works/);
    assert.match(html, /Roof sheeting/);
    assert.doesNotMatch(html, />Windows</);
  });

  test("a stage with nothing matching renders nothing", () => {
    const html = render(true, { ...NO_FINANCIAL_FILTER, search: "plumbing" });
    assert.equal(html, "");
  });
});

describe("StageFinancialsCard pricing", () => {
  test("every activity row offers to edit its quoted price", () => {
    const html = render(true);
    assert.match(html, /aria-label="Edit the quoted price for Lock-up works"/);
    assert.match(html, /aria-label="Edit the quoted price for Roof sheeting"/);
  });

  test("a pegged stage names its contract share and what is unallocated", () => {
    const html = render({}, undefined, {
      ...report.stages[0],
      allocatedCents: 500_00,
      price: {
        claimCents: 880_00,
        exGstCents: 800_00,
        gstIncluded: true,
        percentage: 25,
      },
    });
    assert.match(html, /25% of contract · \$880\.00 inc GST/);
    assert.match(html, /\$300\.00 not allocated to an activity/);
  });

  test("activities priced past the stage say by how much", () => {
    const html = render({}, undefined, {
      ...report.stages[0],
      price: {
        claimCents: 400_00,
        exGstCents: 400_00,
        gstIncluded: false,
        percentage: 25,
      },
    });
    assert.match(html, /Activities over by \$100\.00/);
  });
});
