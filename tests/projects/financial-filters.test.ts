import assert from "node:assert/strict";
import {
  InvoiceStatus,
  MilestoneStatus,
  ProjectStage,
  TradieInvoiceSource,
  TradieScheduleStatus,
} from "@prisma/client";
import { describe, test } from "vitest";

import { buildProjectFinancialReport } from "@/lib/domain/projects/financial-report";
import {
  activityMatches,
  countMatches,
  NO_FINANCIAL_FILTER,
  type FinancialFilter,
} from "@/lib/projects/financial-filters";

// The Financials tab's one filter across every stage. A match deep in a tree
// must stay reachable, and a parent found by name must show what is under it.

const report = buildProjectFinancialReport({
  bookings: [
    {
      id: "b-loss",
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
      scheduleId: "b-loss",
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

const [parent] = report.stages[0].activities;
const [roof, windows] = parent.children;
const filter = (overrides: Partial<FinancialFilter>): FinancialFilter => ({
  ...NO_FINANCIAL_FILTER,
  ...overrides,
});

describe("financial filter", () => {
  test("no filter shows everything", () => {
    assert.deepEqual(countMatches([parent], NO_FINANCIAL_FILTER), {
      shown: 3,
      total: 3,
    });
  });

  test("a loss on a child keeps its parent, and not its profitable sibling", () => {
    const loss = filter({ view: "loss" });
    assert.equal(activityMatches(parent, loss), true);
    assert.equal(activityMatches(roof, loss, [parent.name]), true);
    assert.equal(activityMatches(windows, loss, [parent.name]), false);
    assert.deepEqual(countMatches([parent], loss), { shown: 2, total: 3 });
  });

  test("searching a parent's name shows everything under it", () => {
    assert.deepEqual(countMatches([parent], filter({ search: "lock-up" })), {
      shown: 3,
      total: 3,
    });
  });

  test("search reaches tradies and invoice numbers", () => {
    assert.deepEqual(countMatches([parent], filter({ search: "tr-77" })), {
      shown: 2,
      total: 3,
    });
    assert.deepEqual(countMatches([parent], filter({ search: "top roof" })), {
      shown: 2,
      total: 3,
    });
  });

  test("a tradie filter keeps the activities they are booked on", () => {
    assert.deepEqual(countMatches([parent], filter({ tradieId: "roofer" })), {
      shown: 2,
      total: 3,
    });
  });

  test("over-invoiced", () => {
    assert.deepEqual(countMatches([parent], filter({ view: "over" })), {
      shown: 2,
      total: 3,
    });
  });
});
