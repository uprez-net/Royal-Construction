import assert from "node:assert/strict";
import { describe, test } from "vitest";

import type { DomainDb } from "@/lib/domain/db";
import {
  invoiceReminderDue,
  staleInvoiceReminders,
} from "@/lib/domain/tradies/invoice-inbox";
import { createNotification } from "@/types/notification";

// #588: an emailed invoice sat PENDING for 17 days. Nothing reminded anyone.
const NOW = new Date("2026-11-22T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("invoiceReminderDue", () => {
  test("nudges on day 3, 6, 9 and not in between", () => {
    const due = [0, 1, 2, 3, 4, 5, 6, 17, 18].map((n) =>
      invoiceReminderDue(daysAgo(n), NOW),
    );
    assert.deepEqual(due, [false, false, false, true, false, false, true, false, true]);
  });
});

describe("staleInvoiceReminders", () => {
  const dbWith = (rows: unknown[]) =>
    ({ tradieInvoiceInbox: { findMany: async () => rows } }) as unknown as DomainDb;
  const row = (projectId: string, name: string, n: number) => ({
    project: { name },
    projectId,
    receivedAt: daysAgo(n),
  });

  test("one message per project, counting everything pending there", async () => {
    const result = await staleInvoiceReminders(
      dbWith([row("p1", "Alpha", 6), row("p1", "Alpha", 3), row("p2", "Beta", 4)]),
      NOW,
    );
    // p2's oldest is 4 days: not due today.
    assert.deepEqual(result, [
      { count: 2, oldestDays: 6, projectId: "p1", projectName: "Alpha" },
    ]);
  });

  test("nothing pending, nothing to say", async () => {
    assert.deepEqual(await staleInvoiceReminders(dbWith([]), NOW), []);
  });
});

test("the notification reads plainly for one and for several", () => {
  const one = createNotification("tradieInvoiceWaiting", {
    count: 1, days: 6, projectId: "p", projectName: "Alpha",
  });
  assert.match(one.message, /^An emailed invoice has been waiting to be confirmed for 6 days\./);
  assert.equal(one.url, "/projects/p?activeTab=financials");
  const many = createNotification("tradieInvoiceWaiting", {
    count: 3, days: 9, projectId: "p", projectName: "Alpha",
  });
  assert.match(many.message, /^3 emailed invoices have been waiting to be confirmed, the oldest for 9 days\./);
});
